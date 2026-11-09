import * as turf from "@turf/turf";

import { geoSpatialVoronoi } from "./voronoi";

// Pure geometry: no app state or network access in the worker.
export function calculateTentacleGeometry(input: any) {
    const voronoi = geoSpatialVoronoi(input.points);
    if (input.kind === "voronoi") return voronoi;
    if (input.kind === "adjust") {
        const polygon = voronoi.features.find(
            (feature: any) =>
                feature.properties.site.properties.name === input.name,
        );
        if (!polygon) return input.mapData;
        const union =
            input.mapData.features.length === 1
                ? input.mapData.features[0]
                : turf.union(input.mapData);
        if (!union) throw new Error("No map area available");
        return turf.intersect(
            turf.featureCollection([union, polygon, input.circle]),
        );
    }
    const polygons = voronoi.features
        .map((feature) =>
            turf.intersect(turf.featureCollection([feature, input.circle])),
        )
        .filter((feature) => feature !== null);
    return turf.combine(
        turf.featureCollection(
            polygons.flatMap((polygon) => {
                const lines = turf.polygonToLine(polygon);
                return lines.type === "FeatureCollection"
                    ? lines.features
                    : [lines];
            }),
        ),
    );
}

// Kept separate from the entry module so the pure calculation is testable.
