export default {
    async fetch(request: Request, env: { MAPS: R2Bucket }) {
        const headers = new Headers({
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "Range, If-Match",
            "Access-Control-Expose-Headers":
                "Content-Range, Accept-Ranges, ETag",
        });
        if (request.method === "OPTIONS")
            return new Response(null, { status: 204, headers });
        if (!["GET", "HEAD"].includes(request.method))
            return new Response(null, { status: 405, headers });

        const key = new URL(request.url).pathname.slice(1);
        if (
            !/^[a-z]{2}\/(?:[\w-]+\.pmtiles|game-data\/(?:manifest\.json|[\w-]+\.(?:pack|json(?:\.gz)?)))$/.test(
                key,
            )
        ) {
            return new Response(null, { status: 404, headers });
        }

        const rangeHeader = request.headers.get("Range");
        const range = rangeHeader?.match(/^bytes=(\d+)-(\d+)$/);
        const offset = Number(range?.[1]);
        const end = Number(range?.[2]);
        if (
            rangeHeader &&
            (!range ||
                !Number.isSafeInteger(offset) ||
                !Number.isSafeInteger(end) ||
                end < offset)
        ) {
            return new Response(null, { status: 416, headers });
        }
        const metadata =
            range || request.method === "HEAD"
                ? await env.MAPS.head(key)
                : null;
        if ((range || request.method === "HEAD") && !metadata)
            return new Response(null, { status: 404, headers });
        if (metadata && range && offset >= metadata.size) {
            headers.set("Content-Range", `bytes */${metadata.size}`);
            return new Response(null, { status: 416, headers });
        }
        const length =
            range && metadata
                ? Math.min(end + 1, metadata.size) - offset
                : undefined;
        const object =
            request.method === "HEAD"
                ? metadata
                : await env.MAPS.get(
                      key,
                      length === undefined
                          ? undefined
                          : { range: { offset, length } },
                  );
        if (!object) return new Response(null, { status: 404, headers });
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        headers.set("Accept-Ranges", "bytes");
        headers.set("Content-Length", String(length ?? object.size));
        if (length !== undefined)
            headers.set(
                "Content-Range",
                `bytes ${offset}-${offset + length - 1}/${object.size}`,
            );
        return new Response(
            "body" in object ? (object as R2ObjectBody).body : null,
            { status: length === undefined ? 200 : 206, headers },
        );
    },
};
