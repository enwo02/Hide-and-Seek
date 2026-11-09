import * as turf from "@turf/turf";
import _ from "lodash";

import { GEOCODER_API } from "./constants";
import { convertToLatLong } from "./geo";
import { elementPoint, geometryGeoJSON, getLocalPack } from "./local-data";
import type { OpenStreetMap } from "./types";

export const geocode = async (
    address: string,
    language: string,
    filter: boolean = true,
) => {
    const pack = await getLocalPack();
    if (pack && address.trim().length >= 2) {
        const normalize = (text: string) =>
            text
                .normalize("NFD")
                .replace(/\p{Diacritic}/gu, "")
                .toLowerCase();
        const query = normalize(address.trim());
        const candidates = (
            filter
                ? pack.geometry.filter(
                      (el) =>
                          el.type === "relation" &&
                          el.tags?.boundary === "administrative",
                  )
                : [...pack.elements, ...pack.geometry]
        ).filter((el) =>
            Object.entries(el.tags ?? {}).some(
                ([key, value]) =>
                    (key === "name" || key.startsWith("name:")) &&
                    normalize(value).includes(query),
            ),
        );
        const matches = _.uniqBy(candidates, (el) => `${el.type}/${el.id}`)
            .sort(
                (a, b) =>
                    Number(normalize(b.tags?.name ?? "") === query) -
                    Number(normalize(a.tags?.name ?? "") === query),
            )
            .slice(0, 20);
        const local: OpenStreetMap[] = (
            await Promise.all(
                matches.map(async (el): Promise<OpenStreetMap[]> => {
                    const name =
                        el.tags?.[`name:${language}`] ??
                        el.tags?.name ??
                        el.tags?.["name:en"];
                    if (!name) return [];
                    const point = elementPoint(el);
                    const geo =
                        point ??
                        (el.bounds
                            ? turf.bboxPolygon([
                                  el.bounds.minlon,
                                  el.bounds.minlat,
                                  el.bounds.maxlon,
                                  el.bounds.maxlat,
                              ])
                            : await geometryGeoJSON(pack, el));
                    if ("features" in geo && !geo.features.length) return [];
                    const [west, south, east, north] = turf.bbox(geo);
                    return [
                        {
                            type: "Feature",
                            geometry: {
                                type: "Point",
                                coordinates: [
                                    (south + north) / 2,
                                    (west + east) / 2,
                                ],
                            },
                            properties: {
                                osm_type: (
                                    {
                                        node: "N",
                                        way: "W",
                                        relation: "R",
                                    } as const
                                )[el.type],
                                osm_id: el.id,
                                name,
                                state:
                                    el.tags?.boundary === "administrative"
                                        ? (
                                              {
                                                  "2": "Country",
                                                  "4": el.tags[
                                                      "ISO3166-2"
                                                  ]?.startsWith("CH-")
                                                      ? "Canton"
                                                      : "Region",
                                                  "6": "District",
                                                  "8": "Municipality",
                                              } as Record<string, string>
                                          )[el.tags.admin_level]
                                        : undefined,
                                osm_key: filter ? "boundary" : "place",
                                osm_value: "administrative",
                                type: "administrative",
                                countrycode: "",
                                extent: [north, west, south, east],
                            },
                        },
                    ];
                }),
            )
        ).flat();
        if (local.length || navigator.onLine === false) return local;
    }
    const features = (
        await (
            await fetch(`${GEOCODER_API}?lang=${language}&q=${address}`)
        ).json()
    ).features as OpenStreetMap[];

    features.forEach((feature) => {
        feature.geometry.coordinates = convertToLatLong(
            feature.geometry.coordinates as number[],
        );
        if (!feature.properties.extent) return;
        feature.properties.extent = [
            feature.properties.extent[1],
            feature.properties.extent[0],
            feature.properties.extent[3],
            feature.properties.extent[2],
        ];
    });

    return _.uniqBy(
        features.filter((feature) => {
            return filter ? feature.properties.osm_type === "R" : true;
        }),
        (feature) => feature.properties.osm_id,
    );
};
