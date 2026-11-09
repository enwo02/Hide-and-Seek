import esriConfig from "@arcgis/core/config.js";
import { version } from "@arcgis/core/package.json";

import { cacheFetch, determineCache } from "./cache";
import { CacheType } from "./types";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export const geometryAssetsPath = `${base}/runtime/arcgis-${version}`;
esriConfig.assetsPath = geometryAssetsPath;

export async function prepareQuestionRuntime(signal?: AbortSignal) {
    for (const url of [
        `${geometryAssetsPath}/esri/geometry/support/pe-wasm.wasm`,
        `${base}/coastline50.geojson`,
    ]) {
        signal?.throwIfAborted();
        const response = await cacheFetch(
            url,
            undefined,
            CacheType.PERMANENT_CACHE,
            signal,
        );
        if (!response.ok)
            throw new Error(
                "Could not save calculation files. Please retry while online.",
            );
        if (
            !(await (
                await determineCache(CacheType.PERMANENT_CACHE)
            ).match(url))
        )
            throw new Error(
                "Not enough browser storage to save calculation files. Free space and retry.",
            );
    }
}
