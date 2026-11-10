import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { atom } from "nanostores";
import osmtogeojson from "osmtogeojson";

import { prepareQuestionRuntime } from "./runtime-assets";

export interface LocalElement {
    type: "node" | "way" | "relation";
    id: number;
    tags?: Record<string, string>;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    [key: string]: any;
}

export interface GameDataPack {
    schemaVersion: 1;
    name: string;
    bbox: [number, number, number, number];
    createdAt: string;
    boundaries?: boolean;
    highspeed?: boolean;
    coverage?: Feature<Polygon | MultiPolygon>;
    trainLines?: {
        stations: { id: number; lon: number; lat: number }[];
        ways: { id: number; tags: Record<string, string>; nodes: number[] }[];
        relations: {
            id: number;
            tags: Record<string, string>;
            nodes: number[];
        }[];
    };
    elements: LocalElement[];
    geometry: LocalElement[];
    geometryAssets?: string[];
    incompleteBoundaries?: number[];
    incompleteGeometry?: { id: number; tags: Record<string, string> }[];
}

const CACHE = "hide-seek-regional-data-v1";
const KEY = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/game-data/installed`;
const assetKey = (file: string) =>
    `${import.meta.env.BASE_URL.replace(/\/$/, "")}/game-data/${file}`;
export const localDataStatus = atom("No regional data downloaded");
let installed: Promise<GameDataPack | null> | undefined;
let indexedPack: GameDataPack | undefined;
const categories = new Map<string, LocalElement[]>();

export function validatePack(value: unknown): asserts value is GameDataPack {
    const pack = value as GameDataPack;
    if (
        pack?.schemaVersion !== 1 ||
        typeof pack.name !== "string" ||
        typeof pack.createdAt !== "string" ||
        !Number.isFinite(Date.parse(pack.createdAt)) ||
        !Array.isArray(pack.bbox) ||
        pack.bbox.length !== 4 ||
        !pack.bbox.every(Number.isFinite) ||
        !(pack.bbox[0] < pack.bbox[2] && pack.bbox[1] < pack.bbox[3]) ||
        pack.bbox[0] < -180 ||
        pack.bbox[2] > 180 ||
        pack.bbox[1] < -90 ||
        pack.bbox[3] > 90 ||
        !Array.isArray(pack.elements) ||
        !Array.isArray(pack.geometry) ||
        [...pack.elements, ...pack.geometry].some(
            (el) =>
                !["node", "way", "relation"].includes(el.type) ||
                !Number.isSafeInteger(el.id) ||
                (el.type === "node" &&
                    (!Number.isFinite(el.lon) || !Number.isFinite(el.lat))) ||
                (el.center &&
                    (!Number.isFinite(el.center.lon) ||
                        !Number.isFinite(el.center.lat))),
        )
    ) {
        throw new Error("Invalid or unsupported game-data pack");
    }
    if (
        pack.geometryAssets &&
        (!Array.isArray(pack.geometryAssets) ||
            pack.geometryAssets.some(
                (file) =>
                    !/^geometry-[a-f0-9]{16}(?:\.pack|\.json\.gz)$/.test(file),
            ))
    )
        throw new Error("Invalid boundary file list");
    if (
        pack.geometry.some(
            (el) => el.file && !pack.geometryAssets?.includes(el.file),
        )
    )
        throw new Error("Missing boundary file list");
    if (
        pack.coverage &&
        !["Polygon", "MultiPolygon"].includes(pack.coverage.geometry?.type)
    )
        throw new Error("Invalid coverage geometry");
}

export async function getLocalPack() {
    installed ??= (async () => {
        const response = await (await caches.open(CACHE)).match(KEY);
        if (!response) return null;
        const pack = await response.json();
        validatePack(pack);
        localDataStatus.set(
            `${pack.name} saved locally (${pack.createdAt.slice(0, 10)})`,
        );
        return pack;
    })().catch((error) => {
        installed = undefined;
        localDataStatus.set(`Local data unavailable: ${error.message}`);
        return null;
    });
    return installed;
}

export async function installPack(pack: unknown) {
    validatePack(pack);
    const cache = await caches.open(CACHE);
    for (const file of pack.geometryAssets ?? []) {
        if (!(await cache.match(assetKey(file))))
            throw new Error(
                "This file needs additional saved boundaries. Use Download regional data to install the complete pack.",
            );
    }
    await cache.put(
        KEY,
        new Response(JSON.stringify(pack), {
            headers: { "Content-Type": "application/json" },
        }),
    );
    installed = Promise.resolve(pack);
    localDataStatus.set(
        `${pack.name} saved locally (${pack.createdAt.slice(0, 10)})`,
    );
    try {
        await navigator.storage?.persist?.();
    } catch {
        /* The pack is saved even if persistence is denied. */
    }
}

export async function removePack() {
    await caches.delete(CACHE);
    installed = undefined;
    indexedPack = undefined;
    categories.clear();
    localDataStatus.set("No regional data downloaded");
}

export async function downloadPack(
    signal: AbortSignal,
    progress: (message: string) => void,
) {
    const base = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/game-data/`;
    const manifestResponse = await fetch(`${base}manifest.json`, {
        signal,
        cache: "no-store",
    });
    if (!manifestResponse.ok)
        throw new Error("Switzerland data is not available on this site yet.");
    const manifest = await manifestResponse.json();
    if (
        manifest.schemaVersion !== 1 ||
        !/^switzerland-[a-f0-9]{16}(?:\.pack|\.json(?:\.gz)?)$/.test(
            manifest.file,
        ) ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
        !Number.isSafeInteger(manifest.bytes) ||
        manifest.bytes <= 0
    ) {
        throw new Error("Invalid game-data manifest");
    }
    const assets = manifest.assets ?? [];
    const descriptors = [manifest, ...assets];
    if (
        !Array.isArray(assets) ||
        descriptors.some(
            (asset) =>
                !/^(?:switzerland|geometry)-[a-f0-9]{16}(?:\.pack|\.json(?:\.gz)?)$/.test(
                    asset.file,
                ) ||
                !/^[a-f0-9]{64}$/.test(asset.sha256) ||
                !Number.isSafeInteger(asset.bytes) ||
                asset.bytes <= 0,
        )
    )
        throw new Error("Invalid game-data file list");
    const total = descriptors.reduce((sum, asset) => sum + asset.bytes, 0);
    const cache = await caches.open(CACHE);
    let completed = 0;
    const download = async (asset: any) => {
        const key = `${base}${asset.file}`;
        const saved = await cache.match(key);
        if (
            saved &&
            saved.headers.get("x-game-sha256") === asset.sha256 &&
            saved.headers.get("x-game-bytes") === String(asset.bytes)
        ) {
            completed += asset.bytes;
            progress(
                `Saving game data: ${(completed / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`,
            );
            return saved;
        }
        const response = await fetch(key, { signal });
        if (!response.ok || !response.body)
            throw new Error("Could not download game data");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            progress(
                `Downloading game data: ${((completed + received) / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`,
            );
        }
        const bytes = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (received !== asset.bytes || hash !== asset.sha256)
            throw new Error("Download incomplete or damaged. Please retry.");
        signal.throwIfAborted();
        const stored = new Response(bytes, {
            headers: {
                "x-game-sha256": asset.sha256,
                "x-game-bytes": String(asset.bytes),
            },
        });
        await cache.put(key, stored.clone());
        completed += received;
        return stored;
    };
    const core = await download(manifest);
    const pack = await readPackFile(
        await core.blob(),
        manifest.file.endsWith(".gz") || manifest.file.endsWith(".pack"),
    );
    validatePack(pack);
    if (
        (pack.geometryAssets ?? []).some(
            (file) => !assets.some((asset: any) => asset.file === file),
        )
    )
        throw new Error("The boundary download list is incomplete");
    for (const asset of assets) await download(asset);
    progress("Saving calculation files…");
    await prepareQuestionRuntime(signal);
    signal.throwIfAborted();
    await installPack(pack);
}

export async function readPackFile(file: Blob, compressed: boolean) {
    const text = compressed
        ? await new Response(
              file.stream().pipeThrough(new DecompressionStream("gzip")),
          ).text()
        : await file.text();
    return JSON.parse(text);
}

export function containsBox(pack: GameDataPack, box: number[]) {
    return (
        box[0] >= pack.bbox[0] &&
        box[1] >= pack.bbox[1] &&
        box[2] <= pack.bbox[2] &&
        box[3] <= pack.bbox[3]
    );
}

const polygonCoverage = new WeakMap<GameDataPack, WeakMap<object, boolean>>();
export function coverageContains(pack: GameDataPack, polygon: any) {
    if (!containsBox(pack, turf.bbox(polygon))) return false;
    if (!pack.coverage) return true;
    let results = polygonCoverage.get(pack);
    if (!results) {
        results = new WeakMap();
        polygonCoverage.set(pack, results);
    }
    const previous = results.get(polygon);
    if (previous !== undefined) return previous;
    const features = "features" in polygon ? polygon.features : [polygon];
    const complete = features.every(
        (feature: any) =>
            turf.difference(
                turf.featureCollection([feature, pack.coverage!]),
            ) === null,
    );
    results.set(polygon, complete);
    return complete;
}

const geometryChunks = new WeakMap<
    GameDataPack,
    Map<string, Promise<LocalElement[]>>
>();
export async function resolveGeometry(
    pack: GameDataPack,
    element: LocalElement,
) {
    let chunks = geometryChunks.get(pack);
    if (!chunks) {
        chunks = new Map();
        geometryChunks.set(pack, chunks);
    }
    const included = new Map<string, LocalElement>();
    const add = async (el: LocalElement) => {
        const key = `${el.type}/${el.id}`;
        if (included.has(key)) return;
        let raw = el;
        if (el.file) {
            if (!chunks!.has(el.file))
                chunks!.set(
                    el.file,
                    (async () => {
                        const response = await (
                            await caches.open(CACHE)
                        ).match(assetKey(el.file));
                        if (!response)
                            throw new Error(
                                "Some saved boundaries are missing. Download regional data again.",
                            );
                        return readPackFile(await response.blob(), true);
                    })(),
                );
            const found = (await chunks!.get(el.file)!).find(
                (candidate) =>
                    candidate.id === el.id && candidate.type === el.type,
            );
            if (!found)
                throw new Error(
                    "Saved boundary file is incomplete. Download regional data again.",
                );
            raw = found;
        }
        included.set(key, raw);
        for (const member of raw.members ?? [])
            if (member.type === "relation") {
                const child = pack.geometry.find(
                    (candidate) =>
                        candidate.type === member.type &&
                        candidate.id === member.ref,
                );
                if (child) await add(child);
            }
    };
    await add(element);
    return { elements: [...included.values()] };
}

const convertedGeometry = new WeakMap<
    LocalElement,
    Promise<ReturnType<typeof osmtogeojson>>
>();
export function geometryGeoJSON(pack: GameDataPack, element: LocalElement) {
    if (!convertedGeometry.has(element))
        convertedGeometry.set(
            element,
            resolveGeometry(pack, element).then((data) => osmtogeojson(data)),
        );
    return convertedGeometry.get(element)!;
}

export function localTrainLineNodes(
    pack: GameDataPack,
    seekerId: number,
    hiderId: number,
) {
    const lines = pack.trainLines;
    if (
        !lines ||
        !lines.stations.some((s) => s.id === seekerId) ||
        !lines.stations.some((s) => s.id === hiderId)
    )
        return null;
    const parents = [...lines.ways, ...lines.relations].filter((parent) =>
        parent.nodes.includes(seekerId),
    );
    const keys = ["name", "name:en", "network"];
    const values = new Map(
        keys.map((key) => [
            key,
            new Set(parents.map((parent) => parent.tags[key]).filter(Boolean)),
        ]),
    );
    return [
        ...new Set(
            lines.ways
                .filter((way) =>
                    keys.some((key) => values.get(key)!.has(way.tags[key])),
                )
                .flatMap((way) => way.nodes),
        ),
    ];
}

export function elementPoint(element: LocalElement) {
    const coords = element.center ?? element;
    return typeof coords.lon === "number" && typeof coords.lat === "number"
        ? turf.point([coords.lon, coords.lat])
        : null;
}

// A deliberately small tag-filter parser, covering the selectors used by the app.
// Unsupported syntax must fall back, never silently produce an empty answer.
export function tagPredicate(
    filter: string,
): ((el: LocalElement) => boolean) | null {
    const clauses = [...filter.matchAll(/\[((?:"[^"]*"|[^\]" ])+)\]/g)];
    if (!clauses.length || clauses.map((c) => c[0]).join("") !== filter)
        return null;
    const tests: ((tags: Record<string, string>) => boolean)[] = [];
    for (const clause of clauses) {
        const match = clause[1].match(
            /^"?([^"!=~]+)"?\s*(?:(=|!=|~)\s*(?:"([^"]*)"|([^"\s]+)))?$/,
        );
        if (!match) return null;
        const [, key, operator, quoted, plain] = match;
        const value = quoted ?? plain;
        if (!operator) tests.push((tags) => key in tags);
        else if (operator === "=") tests.push((tags) => tags[key] === value);
        else if (operator === "!=") tests.push((tags) => tags[key] !== value);
        else {
            let regex: RegExp;
            try {
                regex = new RegExp(value);
            } catch {
                return null;
            }
            tests.push((tags) => key in tags && regex.test(tags[key]));
        }
    }
    return (el) => tests.every((test) => test(el.tags ?? {}));
}

export function categoryElements(
    pack: GameDataPack,
    key: string,
    value: string,
) {
    if (indexedPack !== pack) {
        categories.clear();
        indexedPack = pack;
    }
    const category = `${key}=${value}`;
    if (!categories.has(category))
        categories.set(
            category,
            pack.elements.filter((el) => el.tags?.[key] === value),
        );
    return categories.get(category)!;
}

export function supportsFilter(filter: string) {
    const simple = filter.match(/^\["?([^"=]+)"?="?([^"\]]+)"?\]$/);
    const allowed: Record<string, string[]> = {
        tourism: ["aquarium", "museum", "theme_park", "zoo"],
        amenity: ["hospital", "cinema", "library", "ferry_terminal"],
        natural: ["peak"],
        leisure: ["park", "golf_course"],
        diplomatic: ["consulate"],
        railway: ["station", "halt", "stop", "tram_stop", "funicular"],
        highway: ["bus_stop"],
        aerialway: ["station"],
        "brand:wikidata": ["Q38076", "Q259340"],
    };
    return (
        !!(simple && allowed[simple[1]]?.includes(simple[2])) ||
        [
            '["aeroway"="aerodrome"]["iata"]',
            '[place=city]["population"~"^[1-9]+[0-9]{6}$"]',
            "[public_transport=platform][platform=ferry]",
            "[railway=station][subway!=yes]",
            "[railway=station][subway=yes]",
            "[railway=station][light_rail=yes]",
            "[railway=halt][light_rail=yes]",
        ].includes(filter)
    );
}

const zoneResults = new WeakMap<
    GameDataPack,
    WeakMap<object, Map<string, LocalElement[]>>
>();
export function localPlaces(
    pack: GameDataPack,
    polygon: any,
    filters: string[],
    searchType: string,
) {
    let zones = zoneResults.get(pack);
    if (!zones) {
        zones = new WeakMap();
        zoneResults.set(pack, zones);
    }
    let results = zones.get(polygon);
    if (!results) {
        results = new Map();
        zones.set(polygon, results);
    }
    const key = JSON.stringify([filters, searchType]);
    if (!results.has(key)) {
        const predicates = filters.map(tagPredicate);
        if (predicates.some((predicate) => !predicate))
            throw new Error("Unsupported local location filter");
        const polygons = (
            "features" in polygon ? polygon.features : [polygon]
        ).map((poly: any) => ({ polygon: poly, bbox: turf.bbox(poly) }));
        const types: Record<string, string[]> = {
            nwr: ["node", "way", "relation"],
            nw: ["node", "way"],
            wr: ["way", "relation"],
            nr: ["node", "relation"],
        };
        results.set(
            key,
            pack.elements.filter((el) => {
                if (
                    !(
                        searchType === el.type ||
                        types[searchType]?.includes(el.type)
                    )
                )
                    return false;
                if (!predicates.some((predicate) => predicate!(el)))
                    return false;
                const point = elementPoint(el);
                if (!point) return false;
                const [lng, lat] = point.geometry.coordinates;
                return polygons.some(
                    ({ polygon, bbox }: any) =>
                        lng >= bbox[0] &&
                        lat >= bbox[1] &&
                        lng <= bbox[2] &&
                        lat <= bbox[3] &&
                        turf.booleanPointInPolygon(point, polygon),
                );
            }),
        );
    }
    return { elements: [...results.get(key)!] };
}

const radiusCoverage = new WeakMap<GameDataPack, Map<string, boolean>>();
export function localRadius(
    pack: GameDataPack,
    key: string,
    value: string,
    lng: number,
    lat: number,
    radiusKm: number,
) {
    const center = turf.point([lng, lat]);
    // Exact spherical extent, rather than an inscribed polygon that can miss
    // the edge of the search disk and incorrectly claim complete coverage.
    const angle = radiusKm / 6371.0088;
    const latDelta = (angle * 180) / Math.PI;
    const lonDelta =
        Math.abs(lat) + latDelta >= 90
            ? 180
            : (Math.asin(Math.sin(angle) / Math.cos((lat * Math.PI) / 180)) *
                  180) /
              Math.PI;
    if (
        !Number.isFinite(radiusKm) ||
        radiusKm < 0 ||
        !containsBox(pack, [
            lng - lonDelta,
            lat - latDelta,
            lng + lonDelta,
            lat + latDelta,
        ])
    )
        return null;
    if (pack.coverage) {
        let results = radiusCoverage.get(pack);
        if (!results) {
            results = new Map();
            radiusCoverage.set(pack, results);
        }
        const key = `${lng},${lat},${radiusKm}`;
        if (!results.has(key)) {
            if (results.size >= 128)
                results.delete(results.keys().next().value!);
            results.set(
                key,
                coverageContains(
                    pack,
                    turf.circle(center, radiusKm / Math.cos(Math.PI / 64), {
                        steps: 64,
                    }),
                ),
            );
        }
        if (!results.get(key)) return null;
    }
    return categoryElements(pack, key, value).filter((el) => {
        const point = elementPoint(el);
        return point && turf.distance(center, point) <= radiusKm;
    });
}
