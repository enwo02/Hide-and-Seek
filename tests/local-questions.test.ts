import * as turf from "@turf/turf";
import { atom } from "nanostores";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/context", () => ({
    activeAdditionalLocations: atom([]),
    activeMapBoundary: atom(
        turf.featureCollection([turf.bboxPolygon([8, 47, 9, 48])]),
    ),
    activeMapLocation: atom(null),
    activePolygon: atom(null),
    overpassCustomHost: atom(""),
    overpassHost: atom(""),
}));
vi.mock("@/maps/geo-utils", () => ({
    safeUnion: (data: any) => data.features[0],
}));

import { installPack, removePack } from "../src/maps/api/local-data";
import { geocode } from "../src/maps/api/geocode";
import {
    findPlacesInZone,
    findTentacleLocations,
} from "../src/maps/api/overpass";

afterEach(() => vi.unstubAllGlobals());

it("answers actual tentacle and station requests locally with network disabled", async () => {
    vi.stubGlobal("caches", {
        open: async () => ({ put: async () => {} }),
        delete: async () => true,
    });
    vi.stubGlobal("navigator", {});
    const network = vi.fn(() => {
        throw new Error("Network disabled");
    });
    vi.stubGlobal("fetch", network);
    await removePack();
    await installPack({
        schemaVersion: 1,
        name: "Integration region",
        createdAt: "2026-11-08",
        bbox: [5, 45, 11, 49],
        geometry: [
            {
                type: "relation",
                id: 9,
                tags: {
                    name: "Zürich",
                    boundary: "administrative",
                    admin_level: "8",
                },
                bounds: {
                    minlon: 8.4,
                    minlat: 47.3,
                    maxlon: 8.7,
                    maxlat: 47.5,
                },
            },
        ],
        elements: [
            {
                type: "node",
                id: 1,
                lon: 8.54,
                lat: 47.37,
                tags: { tourism: "museum", name: "Museum" },
            },
            {
                type: "node",
                id: 2,
                lon: 8.54,
                lat: 47.37,
                tags: { railway: "station", name: "Station" },
            },
            {
                type: "node",
                id: 3,
                lon: 9.54,
                lat: 47.37,
                tags: { railway: "station", name: "Outside" },
            },
            {
                type: "way",
                id: 4,
                center: { lon: 8.54, lat: 47.37 },
                tags: { railway: "station", name: "Way station" },
            },
        ],
    });
    const tentacles = await findTentacleLocations({
        locationType: "museum",
        lng: 8.54,
        lat: 47.37,
        radius: 1,
        unit: "kilometers",
    });
    expect(tentacles.features.map((f) => f.properties?.name)).toEqual([
        "Museum",
    ]);
    const stations = await findPlacesInZone(
        "[railway=station]",
        undefined,
        "node",
    );
    expect(stations.elements.map((el: any) => el.id)).toEqual([2]);
    const ways = await findPlacesInZone("[railway=station]", undefined, "way");
    expect(ways.elements.map((el: any) => el.id)).toEqual([4]);
    expect(network).not.toHaveBeenCalled();
    const cities = await geocode("zurich", "de");
    expect(cities[0].properties.name).toBe("Zürich");
    expect(cities[0].properties.state).toBe("Municipality");
    expect(network).not.toHaveBeenCalled();
});
