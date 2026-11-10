import * as turf from "@turf/turf";
import { atom } from "nanostores";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/context", () => ({
    isLoading: atom(false),
    hiderMode: atom(false),
    mapGeoJSON: atom(null),
    mapGeoLocation: atom(null),
    polyGeoJSON: atom(null),
}));
vi.mock("@/maps/api", () => ({}));
vi.mock("@/maps/geo-utils", () => ({
    geoSpatialVoronoi: () =>
        turf.featureCollection([
            turf.bboxPolygon([7, 46, 9, 48]),
            turf.bboxPolygon([9, 46, 11, 48]),
            turf.bboxPolygon([7, 48, 9, 50]),
        ]),
}));

import { matchingPlanningPolygon } from "../src/maps/questions/matching";
import type { MatchingQuestion } from "../src/maps/schema";

it("keeps all zones visible and draws the pin's solid outline last after moving", async () => {
    const question = {
        type: "custom-points",
        geo: [turf.point([8, 47]), turf.point([10, 47]), turf.point([9, 49])],
        lat: 47,
        lng: 8,
    } as MatchingQuestion;
    const first = await matchingPlanningPolygon(question);
    const moved = await matchingPlanningPolygon({ ...question, lng: 10 });
    for (const result of [first, moved]) {
        expect(result && result.type).toBe("FeatureCollection");
        if (!result || result.type !== "FeatureCollection")
            throw new Error("No zones");
        const styles = result.features.map(
            (line) => line.properties?.matchingAlternative,
        );
        expect(styles).toContain(true);
        expect(styles).toContain(false);
        expect(styles).toEqual([...styles].sort().reverse());
        const edges = result.features.map((line) =>
            JSON.stringify([...line.geometry.coordinates].sort()),
        );
        expect(new Set(edges).size).toBe(edges.length);
        expect(edges).toHaveLength(10);
        expect(styles.filter((alternative) => !alternative)).toHaveLength(4);
    }
    if (
        !first ||
        !moved ||
        first.type !== "FeatureCollection" ||
        moved.type !== "FeatureCollection"
    )
        throw new Error("No zones");
    expect(first.features.at(-1)?.geometry).not.toEqual(
        moved.features.at(-1)?.geometry,
    );
});
