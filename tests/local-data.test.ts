import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    downloadPack,
    getLocalPack,
    installPack,
    localRadius,
    localTrainLineNodes,
    coverageContains,
    resolveGeometry,
    readPackFile,
    removePack,
    supportsFilter,
    tagPredicate,
    validatePack,
    type GameDataPack,
} from "../src/maps/api/local-data";
import * as turf from "@turf/turf";

vi.mock("../src/maps/api/runtime-assets", () => ({
    prepareQuestionRuntime: async () => {},
}));

const pack: GameDataPack = {
    schemaVersion: 1,
    name: "Test region",
    createdAt: "2026-11-08T00:00:00Z",
    bbox: [5, 45, 11, 49],
    geometry: [],
    elements: [
        {
            type: "node",
            id: 1,
            lat: 47.37,
            lon: 8.54,
            tags: { tourism: "museum", name: "Near" },
        },
        {
            type: "way",
            id: 2,
            center: { lat: 47.4, lon: 8.6 },
            tags: { tourism: "museum", name: "Further" },
        },
        {
            type: "node",
            id: 3,
            lat: 47.37,
            lon: 8.54,
            tags: { amenity: "library" },
        },
    ],
};

beforeEach(async () => {
    const entries = new Map<string, Response>();
    vi.stubGlobal("caches", {
        open: async () => ({
            match: async (key: string) => entries.get(key)?.clone(),
            put: async (key: string, response: Response) => {
                entries.set(key, response.clone());
            },
        }),
        delete: async () => {
            entries.clear();
            return true;
        },
    });
    vi.stubGlobal("navigator", { storage: { persist: async () => true } });
    await removePack();
});
afterEach(() => vi.unstubAllGlobals());

describe("regional question data", () => {
    it("does not claim coverage across a national border or an extract hole", () => {
        const covered = { ...pack, coverage: turf.bboxPolygon([8, 47, 9, 48]) };
        expect(
            localRadius(covered, "tourism", "museum", 8.54, 47.37, 1),
        ).toHaveLength(1);
        expect(
            localRadius(covered, "tourism", "museum", 8, 47.37, 1),
        ).toBeNull();
        expect(
            coverageContains(covered, turf.bboxPolygon([7.9, 47.1, 8.5, 47.5])),
        ).toBe(false);
    });
    it("matches station lines using both way and parent-relation names", () => {
        const data = {
            ...pack,
            trainLines: {
                stations: [
                    { id: 1, lon: 8.5, lat: 47.3 },
                    { id: 2, lon: 8.6, lat: 47.3 },
                ],
                ways: [{ id: 10, tags: { name: "Line A" }, nodes: [2] }],
                relations: [{ id: 20, tags: { name: "Line A" }, nodes: [1] }],
            },
        };
        expect(localTrainLineNodes(data, 1, 2)).toContain(2);
        expect(localTrainLineNodes(data, 1, 999)).toBeNull();
    });
    it("downloads complete boundary files once and resolves them from storage offline", async () => {
        const geometry = [
            {
                type: "relation",
                id: 9,
                tags: { boundary: "administrative", admin_level: "8" },
                members: [],
            },
        ];
        const compressed = async (value: unknown) =>
            new Uint8Array(
                await new Response(
                    new Blob([JSON.stringify(value)])
                        .stream()
                        .pipeThrough(new CompressionStream("gzip")),
                ).arrayBuffer(),
            );
        const digest = async (bytes: Uint8Array) =>
            Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
                (b) => b.toString(16).padStart(2, "0"),
            ).join("");
        const chunk = await compressed(geometry);
        const chunkHash = await digest(chunk);
        const chunkFile = `geometry-${chunkHash.slice(0, 16)}.json.gz`;
        const data = {
            ...pack,
            geometry: [{ ...geometry[0], members: undefined, file: chunkFile }],
            geometryAssets: [chunkFile],
        };
        const core = await compressed(data);
        const coreHash = await digest(core);
        const coreFile = `switzerland-${coreHash.slice(0, 16)}.json.gz`;
        const manifest = {
            schemaVersion: 1,
            file: coreFile,
            sha256: coreHash,
            bytes: core.length,
            assets: [
                { file: chunkFile, sha256: chunkHash, bytes: chunk.length },
            ],
        };
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) =>
                url.endsWith("manifest.json")
                    ? Response.json(manifest)
                    : new Response(url.endsWith(coreFile) ? core : chunk),
            ),
        );
        await downloadPack(new AbortController().signal, () => {});
        vi.stubGlobal(
            "fetch",
            vi.fn(() => {
                throw new Error("Network disabled");
            }),
        );
        const saved = (await getLocalPack())!;
        expect(saved.geometry[0].members).toBeUndefined();
        expect(
            (await resolveGeometry(saved, saved.geometry[0])).elements,
        ).toEqual(geometry);
    });
    it("reads compressed packs without depending on server compression headers", async () => {
        const compressed = new Blob([JSON.stringify(pack)])
            .stream()
            .pipeThrough(new CompressionStream("gzip"));
        const file = await new Response(compressed).blob();
        expect(await readPackFile(file, true)).toEqual(pack);
    });
    it("reuses a complete region for different positions and radii without fetching", async () => {
        const fetch = vi.fn(() => {
            throw new Error("Network disabled");
        });
        vi.stubGlobal("fetch", fetch);
        await installPack(pack);
        const saved = (await getLocalPack())!;
        expect(
            localRadius(saved, "tourism", "museum", 8.54, 47.37, 1)?.map(
                (el) => el.id,
            ),
        ).toEqual([1]);
        expect(
            localRadius(saved, "tourism", "museum", 8.54, 47.37, 10)?.map(
                (el) => el.id,
            ),
        ).toEqual([1, 2]);
        expect(
            localRadius(saved, "tourism", "museum", 8.6, 47.4, 1)?.map(
                (el) => el.id,
            ),
        ).toEqual([2]);
        expect(fetch).not.toHaveBeenCalled();
    });
    it("distinguishes an empty complete answer from incomplete geographical coverage", () => {
        expect(localRadius(pack, "tourism", "zoo", 8.54, 47.37, 1)).toEqual([]);
        expect(localRadius(pack, "tourism", "museum", 5, 47, 10)).toBeNull();
    });
    it("parses quoted keys, existence, inequality and regexes with brackets", () => {
        const el = {
            ...pack.elements[0],
            tags: {
                aeroway: "aerodrome",
                iata: "ZRH",
                place: "city",
                population: "1234567",
            },
        };
        expect(tagPredicate('["aeroway"="aerodrome"]["iata"]')!(el)).toBe(true);
        expect(
            tagPredicate('[place=city]["population"~"^[1-9]+[0-9]{6}$"]')!(el),
        ).toBe(true);
        expect(tagPredicate("[subway!=yes]")!(el)).toBe(true);
        expect(tagPredicate("[railway=station]")!(el)).toBe(false);
        expect(tagPredicate("[railway=station](around:2,3,4)")).toBeNull();
    });
    it("only claims filters whose underlying data was downloaded", () => {
        for (const filter of [
            "[tourism=museum]",
            '["amenity"="hospital"]',
            '["brand:wikidata"="Q38076"]',
            "[railway=station][subway!=yes]",
            '[place=city]["population"~"^[1-9]+[0-9]{6}$"]',
        ]) {
            expect(supportsFilter(filter), filter).toBe(true);
            expect(tagPredicate(filter), filter).not.toBeNull();
        }
        expect(supportsFilter("[amenity=restaurant]")).toBe(false);
        expect(supportsFilter("[highspeed=yes]")).toBe(false);
    });
    it("rejects malformed imports without replacing the installed pack", async () => {
        await installPack(pack);
        await expect(
            installPack({ ...pack, schemaVersion: 2 }),
        ).rejects.toThrow();
        expect((await getLocalPack())?.name).toBe(pack.name);
        expect(() =>
            validatePack({ ...pack, bbox: [11, 45, 5, 49] }),
        ).toThrow();
    });
    it("rejects corrupt downloads and retains the previous pack", async () => {
        await installPack(pack);
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(
                    Response.json({
                        schemaVersion: 1,
                        file: `switzerland-${"a".repeat(16)}.json`,
                        sha256: "a".repeat(64),
                        bytes: 2,
                    }),
                )
                .mockResolvedValueOnce(new Response("{}")),
        );
        await expect(
            downloadPack(new AbortController().signal, () => {}),
        ).rejects.toThrow("damaged");
        expect((await getLocalPack())?.name).toBe(pack.name);
    });
});
