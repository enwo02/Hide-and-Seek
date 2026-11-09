import _ from "lodash";
import { toast } from "react-toastify";

import { CacheType } from "./types";

const determineQuestionCache = _.memoize(() => caches.open(CacheType.CACHE));
const determineZoneCache = _.memoize(() => caches.open(CacheType.ZONE_CACHE));
const determinePermanentCache = _.memoize(() =>
    caches.open(CacheType.PERMANENT_CACHE),
);

const inFlightFetches = new Map<string, Promise<Response>>();

export const determineCache = async (cacheType: CacheType) => {
    switch (cacheType) {
        case CacheType.CACHE:
            return await determineQuestionCache();
        case CacheType.ZONE_CACHE:
            return await determineZoneCache();
        case CacheType.PERMANENT_CACHE:
            return await determinePermanentCache();
    }
};

export const cacheFetch = async (
    url: string,
    loadingText?: string,
    cacheType: CacheType = CacheType.CACHE,
    signal?: AbortSignal,
) => {
    let cache: Cache | undefined;
    try {
        cache = await determineCache(cacheType);
    } catch {
        // Storage restrictions should not prevent online play.
    }

    const cachedResponse = await cache?.match(url);
    if (cachedResponse) {
        if (!cachedResponse.ok) {
            await cache?.delete(url);
        } else {
            return cachedResponse.clone();
        }
    }

    const inflightKey = `${cacheType}:${url}`;
    const existingFetch = inFlightFetches.get(inflightKey);
    if (existingFetch) {
        const response = await existingFetch;
        return response.clone();
    }

    const fetchAndMaybeCache = async () => {
        if (typeof navigator !== "undefined" && navigator.onLine === false)
            throw new Error(
                "Offline: this question is not available in the saved data.",
            );
        const response = await fetch(url, {
            signal: signal
                ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
                : AbortSignal.timeout(30000),
        });
        try {
            if (response.ok) {
                await cache?.put(url, response.clone());
            } else {
                await cache?.delete(url);
            }
        } catch {
            // A full browser cache must not discard a successful response.
        }
        return response;
    };

    const fetchPromise = fetchAndMaybeCache();
    inFlightFetches.set(inflightKey, fetchPromise);

    try {
        const response = await (loadingText
            ? toast.promise(fetchPromise, {
                  pending: loadingText,
              })
            : fetchPromise);

        return response.clone();
    } finally {
        inFlightFetches.delete(inflightKey);
    }
};

export const clearCache = async (cacheType: CacheType = CacheType.CACHE) => {
    try {
        const cache = await determineCache(cacheType);
        await cache.keys().then((keys) => {
            keys.forEach((key) => {
                cache.delete(key);
            });
        });
    } catch (e) {
        console.log(e); // Probably a caches not supported error
    }
};
