import "maplibre-gl/dist/maplibre-gl.css";

import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { layers, LIGHT } from "@protomaps/basemaps";
import { addProtocol, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";

setWorkerUrl(workerUrl);
addProtocol("pmtiles", new Protocol().tile);

const attribution =
    '<a href="https://protomaps.com/">Protomaps</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function createSwissVectorBasemap() {
    const archive = new URL(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}/switzerland-20261110.pmtiles`,
        window.location.origin,
    );

    const layer = maplibreGL({
        attributionControl: { customAttribution: attribution },
        interactive: false,
        canvasContextAttributes: { preserveDrawingBuffer: true },
        style: {
            version: 8,
            glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
            sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
            sources: {
                protomaps: {
                    type: "vector",
                    url: `pmtiles://${archive.href}`,
                    attribution,
                },
            },
            layers: layers(
                "protomaps",
                {
                    ...LIGHT,
                    background: "#f6f5f2",
                    earth: "#f6f5f2",
                    buildings: "#e4e1dc",
                    water: "#b9d8e9",
                    railway: "#78283b",
                },
                { lang: "de" },
            ),
        },
    });

    const remove = layer.onRemove;
    layer.onRemove = (map) => {
        // Leaflet registers the layer before MapLibre creates its WebGL context.
        // If that creation throws, the adapter has no renderer to dispose.
        if (layer.getMaplibreMap()) return remove.call(layer, map);
        layer.getContainer()?.remove();
        return layer;
    };
    return layer;
}
