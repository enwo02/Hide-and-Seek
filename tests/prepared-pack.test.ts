import * as turf from "@turf/turf";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { atom } from "nanostores";

vi.mock("@/lib/context", () => ({
    additionalMapGeoLocations: atom([]),
    mapGeoJSON: atom(null),
    mapGeoLocation: atom({ properties: { osm_id: 51701, osm_type: "R" } }),
    polyGeoJSON: atom(null),
    overpassCustomHost: atom(""),
    overpassHost: atom(""),
}));
vi.mock("@/maps/geo-utils", () => ({
    safeUnion: (data: any) =>
        data.features.length === 1 ? data.features[0] : turf.union(data),
}));

import {
    coverageContains,
    geometryGeoJSON,
    installPack,
    localRadius,
    validatePack,
} from "../src/maps/api/local-data";
import { determineMapBoundaries } from "../src/maps/api/overpass";

const directory = resolve("public/game-data");
it.skipIf(!existsSync(resolve(directory, "manifest.json")))(
    "verifies the prepared real-world pack and resolves Swiss data with network disabled",
    async () => {
        const manifest = JSON.parse(
            readFileSync(resolve(directory, "manifest.json"), "utf8"),
        );
        const read = (descriptor: any) => {
            const bytes = readFileSync(resolve(directory, descriptor.file));
            expect(bytes.length).toBe(descriptor.bytes);
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(
                descriptor.sha256,
            );
            return bytes;
        };
        const bytes = read(manifest);
        const pack = JSON.parse(
            (manifest.file.endsWith(".gz") || manifest.file.endsWith(".pack")
                ? gunzipSync(bytes)
                : bytes
            ).toString(),
        );
        validatePack(pack);
        for (const descriptor of manifest.assets ?? []) read(descriptor);
        expect(
            new Set(pack.elements.map((el) => `${el.type}/${el.id}`)).size,
        ).toBe(pack.elements.length);
        const entries = new Map<string, Response>();
        vi.stubGlobal("caches", {
            open: async () => ({
                put: async (key: string, response: Response) => {
                    entries.set(key, response.clone());
                },
                match: async (key: string) => entries.get(key)?.clone(),
            }),
        });
        vi.stubGlobal("navigator", {});
        vi.stubGlobal("fetch", () => {
            throw new Error("Network disabled");
        });
        try {
            for (const asset of manifest.assets ?? [])
                entries.set(
                    `/game-data/${asset.file}`,
                    new Response(readFileSync(resolve(directory, asset.file))),
                );
            await installPack(pack);
            const nearby = localRadius(
                pack,
                "tourism",
                "museum",
                8.54,
                47.37,
                2,
            );
            expect(nearby?.length).toBeGreaterThan(0);
            const country = pack.geometry.find(
                (el) => el.type === "relation" && el.id === 51701,
            )!;
            expect(country).toBeDefined();
            const geo = await geometryGeoJSON(pack, country);
            const boundary = geo.features.find(
                (f) => f.properties?.admin_level === "2",
            )!;
            expect(
                turf.booleanPointInPolygon([8.54, 47.37], boundary as any),
            ).toBe(true);
            expect(coverageContains(pack, boundary)).toBe(true);
            const gameArea = await determineMapBoundaries();
            expect(
                gameArea.features.every(
                    (feature) => feature.geometry.type === "MultiPolygon",
                ),
            ).toBe(true);
            expect(turf.area(gameArea)).toBeGreaterThan(30_000_000_000);
        } finally {
            vi.unstubAllGlobals();
        }
    },
    30000,
);
