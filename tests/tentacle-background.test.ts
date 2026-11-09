import * as turf from "@turf/turf";
import { expect, it } from "vitest";

import { tentacleGeometry } from "../src/maps/geo-utils/tentacle-background";

it("preserves the nearest-place area and radius when calculating in the background", async () => {
    const points = turf.featureCollection([
        turf.point([8.53, 47.37], { name: "West museum" }),
        turf.point([8.57, 47.38], { name: "East museum" }),
        turf.point([8.55, 47.41], { name: "North museum" }),
    ]);
    const circle = turf.circle([8.55, 47.38], 4);
    const mapData = turf.featureCollection([
        turf.bboxPolygon([8.48, 47.32, 8.62, 47.44]),
    ]);
    const result = await tentacleGeometry({
        kind: "adjust",
        points,
        circle,
        mapData,
        name: "West museum",
    });
    expect(result).not.toBeNull();
    let inside = 0;
    for (let x = 8.49; x < 8.62; x += 0.007) {
        for (let y = 47.33; y < 47.44; y += 0.007) {
            const point = turf.point([x, y]);
            const expected =
                turf.booleanPointInPolygon(point, circle) &&
                turf.nearestPoint(point, points).properties.name ===
                    "West museum";
            expect(turf.booleanPointInPolygon(point, result)).toBe(expected);
            if (expected) inside++;
        }
    }
    expect(inside).toBeGreaterThan(0);
});
