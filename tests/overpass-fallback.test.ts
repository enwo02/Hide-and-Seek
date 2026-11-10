import { atom } from "nanostores";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/context", () => ({
    isLoading: atom(false),
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

it("aborts loading without trying fallback servers and permits a fresh request", async () => {
    const {
        beginQuestionLoading,
        cancelQuestionLoading,
        finishQuestionLoading,
    } = await import("../src/lib/question-loading");
    const { isLoading } = await import("@/lib/context");
    const old = beginQuestionLoading();
    vi.mocked(cacheFetch).mockImplementationOnce(
        async (_url, _text, _cache, signal) => {
            return new Promise((_resolve, reject) => {
                signal!.addEventListener(
                    "abort",
                    () => reject(signal!.reason),
                    { once: true },
                );
            });
        },
    );
    const pending = getOverpassData("cancel me");
    cancelQuestionLoading();
    expect(isLoading.get()).toBe(false);
    expect(old.signal.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cacheFetch).toHaveBeenCalledTimes(1);

    const next = beginQuestionLoading();
    finishQuestionLoading(old);
    expect(isLoading.get()).toBe(true);
    vi.mocked(cacheFetch).mockResolvedValueOnce(
        Response.json({ elements: [] }),
    );
    await expect(getOverpassData("retry")).resolves.toEqual({ elements: [] });
    finishQuestionLoading(next);
    expect(isLoading.get()).toBe(false);
});
