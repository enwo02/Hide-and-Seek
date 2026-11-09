import * as turf from "@turf/turf";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

import { hiderMode } from "@/lib/context";
import type { DirectionQuestion } from "@/maps/schema";

// North/south follows latitude; east/west follows longitude on the map.
export const adjustPerDirection = async (
    question: DirectionQuestion,
    mapData: FeatureCollection<Polygon | MultiPolygon> | null,
): Promise<FeatureCollection<Polygon | MultiPolygon> | undefined> => {
    if (!mapData) return;
    const bounds: [number, number, number, number] = [-180, -90, 180, 90];
    if (question.axis === "latitude") {
        bounds[question.positive ? 1 : 3] = question.lat;
    } else {
        bounds[question.positive ? 0 : 2] = question.lng;
    }
    if (bounds[0] === bounds[2] || bounds[1] === bounds[3]) {
        return turf.featureCollection([]);
    }
    const half = turf.bboxPolygon(bounds);
    return turf.featureCollection(
        mapData.features.flatMap((feature) => {
            const clipped = turf.intersect(
                turf.featureCollection([feature, half]),
            );
            return clipped ? [clipped] : [];
        }),
    );
};

export const directionPlanningPolygon = async (question: DirectionQuestion) =>
    turf.lineString(
        question.axis === "latitude"
            ? [
                  [-180, question.lat],
                  [180, question.lat],
              ]
            : [
                  [question.lng, -90],
                  [question.lng, 90],
              ],
    );

export const hiderifyDirection = async (question: DirectionQuestion) => {
    const hider = hiderMode.get();
    if (hider !== false) {
        question.positive =
            question.axis === "latitude"
                ? hider.latitude >= question.lat
                : hider.longitude >= question.lng;
    }
    return question;
};
