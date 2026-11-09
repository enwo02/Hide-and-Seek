import { atom } from "nanostores";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/context", () => ({
    additionalMapGeoLocations: atom([]),
    mapGeoJSON: atom(null),
    mapGeoLocation: atom(null),
    polyGeoJSON: atom(null),
    overpassCustomHost: atom(""),
    overpassHost: atom(""),
}));
vi.mock("@/maps/geo-utils", () => ({ safeUnion: vi.fn() }));
vi.mock("@/maps/api/cache", () => ({
    cacheFetch: vi.fn(),
    determineCache: async () => ({ delete: async () => true }),
}));

import { cacheFetch } from "../src/maps/api/cache";
import { getOverpassData } from "../src/maps/api/overpass";

beforeEach(() => vi.mocked(cacheFetch).mockReset());

it("tries another server after network failures and partial HTTP 200 responses", async () => {
    vi.mocked(cacheFetch)
        .mockRejectedValueOnce(new Error("Timed out"))
        .mockResolvedValueOnce(
            Response.json({ remark: "runtime error: timeout", elements: [] }),
        )
        .mockResolvedValueOnce(
            Response.json({ elements: [{ type: "node", id: 123 }] }),
        );
    const data = await getOverpassData("test");
    expect(data.elements).toHaveLength(1);
    expect(cacheFetch).toHaveBeenCalledTimes(3);
});

it("fails visibly rather than treating unavailable data as an empty location list", async () => {
    vi.mocked(cacheFetch).mockResolvedValue(
        new Response("Unavailable", { status: 503 }),
    );
    await expect(getOverpassData("test")).rejects.toThrow(
        "Game data unavailable",
    );
    expect(cacheFetch).toHaveBeenCalledTimes(3);
});
