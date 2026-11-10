import * as turf from "@turf/turf";
import type { FeatureCollection, MultiPolygon } from "geojson";
import _ from "lodash";
import osmtogeojson from "osmtogeojson";
import { toast } from "react-toastify";

import {
    additionalMapGeoLocations,
    mapGeoJSON,
    mapGeoLocation,
    overpassCustomHost,
    overpassHost,
    polyGeoJSON,
} from "@/lib/context";
import { questionLoadingSignal } from "@/lib/question-loading";
import { safeUnion } from "@/maps/geo-utils";

import { cacheFetch, determineCache } from "./cache";
import { LOCATION_FIRST_TAG, OVERPASS_HOSTS } from "./constants";
import {
    containsBox,
    coverageContains,
    elementPoint,
    geometryGeoJSON,
    getLocalPack,
    localPlaces,
    localRadius,
    localTrainLineNodes,
    resolveGeometry,
    supportsFilter,
    tagPredicate,
} from "./local-data";
import type {
    EncompassingTentacleQuestionSchema,
    HomeGameMatchingQuestions,
    HomeGameMeasuringQuestions,
    QuestionSpecificLocation,
} from "./types";
import { CacheType } from "./types";

type TentacleLocationQuery = Pick<
    EncompassingTentacleQuestionSchema,
    "lat" | "lng" | "radius" | "unit" | "locationType"
>;

export const getOverpassData = async (
    query: string,
    loadingText?: string,
    cacheType: CacheType = CacheType.CACHE,
) => {
    const signal = questionLoadingSignal();
    signal?.throwIfAborted();
    const encodedQuery = encodeURIComponent(query);
    const allHostUrls = Object.values(OVERPASS_HOSTS);
    const selectedHost = overpassHost.get();
    const customUrl = overpassCustomHost.get();

    const primaryBaseUrl =
        selectedHost === "custom"
            ? customUrl || allHostUrls[0]
            : selectedHost || allHostUrls[0];
    const fallbackBaseUrls = allHostUrls.filter((h) => h !== primaryBaseUrl);

    const hosts = [primaryBaseUrl, ...fallbackBaseUrls];
    const operation = async () => {
        let lastError: unknown;
        for (const host of hosts) {
            try {
                const response = await cacheFetch(
                    `${host}?data=${encodedQuery}`,
                    undefined,
                    cacheType,
                    signal,
                );
                if (!response.ok)
                    throw new Error(`Server returned ${response.status}`);
                const data = await response.json();
                if (data.remark || !Array.isArray(data.elements)) {
                    const cache = await determineCache(cacheType);
                    await cache.delete(`${host}?data=${encodedQuery}`);
                    throw new Error(
                        data.remark || "Invalid game-data response",
                    );
                }
                return data;
            } catch (error) {
                signal?.throwIfAborted();
                lastError = error;
            }
        }
        throw new Error(
            `Game data unavailable. Download a regional pack in Options, or retry. ${lastError}`,
        );
    };
    const toastId = loadingText ? toast.loading(loadingText) : undefined;
    try {
        return await operation();
    } catch (error) {
        if (!signal?.aborted && loadingText) {
            toast.error(
                "Could not load game data. Try downloading a regional pack in Options.",
            );
        }
        throw error;
    } finally {
        if (toastId !== undefined) toast.dismiss(toastId);
    }
};

export const determineGeoJSON = async (
    osmId: string,
    osmTypeLetter: "W" | "R" | "N",
): Promise<any> => {
    const pack = await getLocalPack();
    const local = pack?.geometry.find(
        (el) =>
            el.id === Number(osmId) &&
            el.type ===
                ({ W: "way", R: "relation", N: "node" } as const)[
                    osmTypeLetter
                ],
    );
    if (local) {
        const geo = structuredClone(await geometryGeoJSON(pack!, local));
        return {
            ...geo,
            features: geo.features.filter(
                (feature) =>
                    feature.geometry?.type === "Polygon" ||
                    feature.geometry?.type === "MultiPolygon",
            ),
        };
    }
    const osmTypeMap: { [key: string]: string } = {
        W: "way",
        R: "relation",
        N: "node",
    };
    const osmType = osmTypeMap[osmTypeLetter];
    const query = `[out:json];${osmType}(${osmId});out geom;`;
    const data = await getOverpassData(
        query,
        "Loading map data...",
        CacheType.PERMANENT_CACHE,
    );
    const geo = osmtogeojson(data);
    return {
        ...geo,
        features: geo.features.filter(
            (feature: any) => feature.geometry.type !== "Point",
        ),
    };
};

export const findTentacleLocations = async (
    question: TentacleLocationQuery,
    text: string = "Determining tentacle locations...",
) => {
    const pack = await getLocalPack();
    const local =
        pack &&
        localRadius(
            pack,
            LOCATION_FIRST_TAG[question.locationType],
            question.locationType,
            question.lng,
            question.lat,
            turf.convertLength(question.radius, question.unit, "kilometers"),
        );
    const query = `
[out:json][timeout:25];
nwr["${LOCATION_FIRST_TAG[question.locationType]}"="${question.locationType}"](around:${turf.convertLength(
        question.radius,
        question.unit,
        "meters",
    )}, ${question.lat}, ${question.lng});
out center;
    `;
    const data =
        local !== null && local !== undefined
            ? { elements: local }
            : await getOverpassData(
                  query,
                  pack ? `Outside downloaded coverage. ${text}` : text,
              );
    const elements = data.elements;
    const response = turf.points([]);
    elements.forEach((element: any) => {
        if (!element.tags["name"] && !element.tags["name:en"]) return;
        if (element.lat && element.lon) {
            const name = element.tags["name:en"] ?? element.tags["name"];
            if (
                response.features.find(
                    (feature: any) => feature.properties.name === name,
                )
            )
                return;
            response.features.push(
                turf.point([element.lon, element.lat], { name }),
            );
        }
        if (!element.center || !element.center.lon || !element.center.lat)
            return;
        const name = element.tags["name:en"] ?? element.tags["name"];
        if (
            response.features.find(
                (feature: any) => feature.properties.name === name,
            )
        )
            return;
        response.features.push(
            turf.point([element.center.lon, element.center.lat], { name }),
        );
    });
    return response;
};

export const findAdminBoundary = async (
    latitude: number,
    longitude: number,
    adminLevel: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
) => {
    const pack = await getLocalPack();
    if (
        pack &&
        (pack.boundaries || adminLevel === 2) &&
        containsBox(pack, [longitude, latitude, longitude, latitude])
    ) {
        const candidates = pack.geometry.filter(
            (el) =>
                el.tags?.admin_level === String(adminLevel) &&
                (!el.bounds ||
                    (longitude >= el.bounds.minlon &&
                        longitude <= el.bounds.maxlon &&
                        latitude >= el.bounds.minlat &&
                        latitude <= el.bounds.maxlat)),
        );
        for (const candidate of candidates) {
            const geo = await geometryGeoJSON(pack, candidate);
            const boundary = geo.features.find(
                (feature) =>
                    (feature.geometry?.type === "Polygon" ||
                        feature.geometry?.type === "MultiPolygon") &&
                    turf.booleanPointInPolygon(
                        [longitude, latitude],
                        feature.geometry,
                    ),
            );
            if (boundary) return boundary;
        }
    }
    const query = `
[out:json];
is_in(${latitude}, ${longitude})->.a;
rel(pivot.a)["admin_level"="${adminLevel}"];
out geom;
    `;
    const data = await getOverpassData(query, "Determining matching zone...");
    const geo = osmtogeojson(data);
    return geo.features?.[0];
};

export const fetchCoastline = async () => {
    const response = await cacheFetch(
        import.meta.env.BASE_URL.replace(/\/$/, "") + "/coastline50.geojson",
        "Fetching coastline data...",
        CacheType.PERMANENT_CACHE,
    );
    const data = await response.json();
    return data;
};

export const trainLineNodeFinder = async (
    node: string,
    hiderStationId?: number,
): Promise<number[]> => {
    const nodeId = node.split("/")[1];
    const pack = await getLocalPack();
    const local =
        pack && hiderStationId !== undefined
            ? localTrainLineNodes(pack, Number(nodeId), hiderStationId)
            : null;
    if (local !== null) return local;
    const tagQuery = `
[out:json];
node(${nodeId});
wr(bn);
out tags;
`;
    const tagData = await getOverpassData(tagQuery, "Finding train line...");
    const query = `
[out:json];
(
${tagData.elements
    .map((element: any) => {
        if (
            !element.tags.name &&
            !element.tags["name:en"] &&
            !element.tags.network
        )
            return "";
        let query = "";
        if (element.tags.name) query += `wr["name"="${element.tags.name}"];`;
        if (element.tags["name:en"])
            query += `wr["name:en"="${element.tags["name:en"]}"];`;
        if (element.tags["network"])
            query += `wr["network"="${element.tags["network"]}"];`;
        return query;
    })
    .join("\n")}
);
out geom;
`;
    const data = await getOverpassData(query, "Finding train lines...");
    const geoJSON = osmtogeojson(data);
    const nodes: number[] = [];
    geoJSON.features.forEach((feature: any) => {
        if (feature && feature.id && feature.id.startsWith("node")) {
            nodes.push(parseInt(feature.id.split("/")[1]));
        }
    });
    data.elements.forEach((element: any) => {
        if (element && element.type === "node") {
            nodes.push(element.id);
        } else if (element && element.type === "way") {
            nodes.push(...element.nodes);
        }
    });
    const uniqNodes = _.uniq(nodes);
    return uniqNodes;
};

export const findPlacesInZone = async (
    filter: string,
    loadingText?: string,
    searchType:
        | "node"
        | "way"
        | "relation"
        | "nwr"
        | "nw"
        | "wr"
        | "nr"
        | "area" = "nwr",
    outType: "center" | "geom" = "center",
    alternatives: string[] = [],
    timeoutDuration: number = 0,
) => {
    // Use the actual game polygon, not its bounding box, to select local points.
    const pack = await getLocalPack();
    const filters = [filter, ...alternatives];
    const predicates = filters.map(tagPredicate);
    if (
        pack &&
        outType === "geom" &&
        predicates.every(Boolean) &&
        (!pack.incompleteBoundaries?.length ||
            (pack.incompleteGeometry &&
                !pack.incompleteGeometry.some((el) =>
                    predicates.some((predicate) =>
                        predicate!({ ...el, type: "relation" }),
                    ),
                ))) &&
        ((pack.highspeed && filter === "[highspeed=yes]") ||
            (pack.boundaries &&
                filters.every((f) => /^\[admin_level=\d+\]/.test(f))))
    ) {
        const polygon =
            mapGeoJSON.get() ??
            polyGeoJSON.get() ??
            (await determineMapBoundaries());
        if (coverageContains(pack, polygon)) {
            const polygons =
                "features" in polygon ? polygon.features : [polygon];
            const selected = pack.geometry.filter(
                (el) =>
                    predicates.some((predicate) => predicate!(el)) &&
                    (searchType === "nwr" || searchType === el.type),
            );
            const box = turf.bbox(polygon);
            const results = await Promise.all(
                selected
                    .filter(
                        (el) =>
                            !el.bounds ||
                            !(
                                el.bounds.maxlon < box[0] ||
                                el.bounds.minlon > box[2] ||
                                el.bounds.maxlat < box[1] ||
                                el.bounds.minlat > box[3]
                            ),
                    )
                    .map(async (el) => {
                        const geo = await geometryGeoJSON(pack, el);
                        return geo.features.some((feature) =>
                            polygons.some((poly: any) =>
                                turf.booleanIntersects(feature, poly),
                            ),
                        )
                            ? (await resolveGeometry(pack, el)).elements
                            : [];
                    }),
            );
            return {
                elements: _.uniqBy(
                    results.flat(),
                    (el) => `${el.type}/${el.id}`,
                ),
            };
        }
    }
    if (
        pack &&
        outType === "center" &&
        filters.every(supportsFilter) &&
        predicates.every(Boolean)
    ) {
        const polygon =
            mapGeoJSON.get() ??
            polyGeoJSON.get() ??
            (await determineMapBoundaries());
        if (coverageContains(pack, polygon)) {
            const data = localPlaces(pack, polygon, filters, searchType);
            const exclusions = await Promise.all(
                additionalMapGeoLocations
                    .get()
                    .filter((entry) => !entry.added)
                    .map((entry) =>
                        determineGeoJSON(
                            entry.location.properties.osm_id.toString(),
                            entry.location.properties.osm_type,
                        ),
                    ),
            );
            if (exclusions.length)
                data.elements = data.elements.filter((el) => {
                    const point = elementPoint(el);
                    return (
                        point &&
                        !exclusions.some((geo) =>
                            geo.features.some((feature: any) =>
                                turf.booleanPointInPolygon(point, feature),
                            ),
                        )
                    );
                });
            return data;
        }
    }
    let query = "";
    const $polyGeoJSON = polyGeoJSON.get();
    if ($polyGeoJSON) {
        query = `
[out:json]${timeoutDuration != 0 ? `[timeout:${timeoutDuration}]` : ""};
(
${searchType}${filter}(poly:"${turf
            .getCoords($polyGeoJSON.features)
            .flatMap((polygon) => polygon.geometry.coordinates)
            .flat()
            .map((coord) => [coord[1], coord[0]].join(" "))
            .join(" ")}");
${
    alternatives.length > 0
        ? alternatives
              .map(
                  (alternative) =>
                      `${searchType}${alternative}(poly:"${turf
                          .getCoords($polyGeoJSON.features)
                          .flatMap((polygon) => polygon.geometry.coordinates)
                          .flat()
                          .map((coord) => [coord[1], coord[0]].join(" "))
                          .join(" ")}");`,
              )
              .join("\n")
        : ""
}
);
out ${outType};
`;
    } else {
        const primaryLocation = mapGeoLocation.get();
        const additionalLocations = additionalMapGeoLocations
            .get()
            .filter((entry) => entry.added)
            .map((entry) => entry.location);
        const allLocations = [primaryLocation, ...additionalLocations];
        const relationToAreaBlocks = allLocations
            .map((loc, idx) => {
                const regionVar = `.region${idx}`;
                return `relation(${loc.properties.osm_id});map_to_area->${regionVar};`;
            })
            .join("\n");
        const searchBlocks = allLocations
            .map((_, idx) => {
                const regionVar = `area.region${idx}`;
                const altQueries =
                    alternatives.length > 0
                        ? alternatives
                              .map(
                                  (alt) => `${searchType}${alt}(${regionVar});`,
                              )
                              .join("\n")
                        : "";
                return `
            ${searchType}${filter}(${regionVar});
            ${altQueries}
          `;
            })
            .join("\n");
        query = `
        [out:json]${timeoutDuration !== 0 ? `[timeout:${timeoutDuration}]` : ""};
        ${relationToAreaBlocks}
        (
        ${searchBlocks}
        );
        out ${outType};
        `;
    }
    const data = await getOverpassData(
        query,
        loadingText,
        CacheType.ZONE_CACHE,
    );
    const subtractedEntries = additionalMapGeoLocations
        .get()
        .filter((e) => !e.added);
    const subtractedPolygons = subtractedEntries.map((entry) => entry.location);
    if (subtractedPolygons.length > 0 && data && data.elements) {
        const turfPolys = await Promise.all(
            subtractedPolygons.map(
                async (location) =>
                    turf.combine(
                        await determineGeoJSON(
                            location.properties.osm_id.toString(),
                            location.properties.osm_type,
                        ),
                    ).features[0],
            ),
        );
        data.elements = data.elements.filter((el: any) => {
            const lon = el.center ? el.center.lon : el.lon;
            const lat = el.center ? el.center.lat : el.lat;
            if (typeof lon !== "number" || typeof lat !== "number")
                return false;
            const pt = turf.point([lon, lat]);
            return !turfPolys.some((poly) =>
                turf.booleanPointInPolygon(pt, poly as any),
            );
        });
    }
    return data;
};

export const findPlacesSpecificInZone = async (
    location: `${QuestionSpecificLocation}`,
) => {
    const locations = (
        await findPlacesInZone(
            location,
            `Finding ${
                location === '["brand:wikidata"="Q38076"]'
                    ? "McDonald's"
                    : "7-Elevens"
            }...`,
        )
    ).elements;
    return turf.featureCollection(
        locations.map((x: any) =>
            turf.point([
                x.center ? x.center.lon : x.lon,
                x.center ? x.center.lat : x.lat,
            ]),
        ),
    );
};

export const nearestToQuestion = async (
    question: HomeGameMatchingQuestions | HomeGameMeasuringQuestions,
) => {
    let radius = 30;
    let instances: any = { features: [] };
    while (instances.features.length === 0 && radius <= 600) {
        instances = await findTentacleLocations(
            {
                lat: question.lat,
                lng: question.lng,
                radius: radius,
                unit: "miles",
                locationType: question.type,
            },
            "Finding matching locations...",
        );
        radius += 30;
    }
    if (instances.features.length === 0)
        throw new Error("No matching locations found within 600 miles");
    const questionPoint = turf.point([question.lng, question.lat]);
    return turf.nearestPoint(questionPoint, instances as any);
};

export const determineMapBoundaries = async () => {
    const mapGeoDatum = await Promise.all(
        [
            {
                location: mapGeoLocation.get(),
                added: true,
                base: true,
            },
            ...additionalMapGeoLocations.get(),
        ].map(async (location) => ({
            added: location.added,
            data: await determineGeoJSON(
                location.location.properties.osm_id.toString(),
                location.location.properties.osm_type,
            ),
        })),
    );

    let mapGeoData = turf.featureCollection([
        safeUnion(
            turf.featureCollection(
                mapGeoDatum
                    .filter((x) => x.added)
                    .flatMap((x) => x.data.features),
            ) as any,
        ),
    ]);

    const differences = mapGeoDatum.filter((x) => !x.added).map((x) => x.data);

    if (differences.length > 0) {
        mapGeoData = turf.featureCollection([
            turf.difference(
                turf.featureCollection([
                    mapGeoData.features[0],
                    ...differences.flatMap((x) => x.features),
                ]),
            )!,
        ]);
    }

    if (turf.coordAll(mapGeoData).length > 10000) {
        turf.simplify(mapGeoData, {
            tolerance: 0.0005,
            highQuality: true,
            mutate: true,
        });
    }

    return turf.combine(mapGeoData) as FeatureCollection<MultiPolygon>;
};
