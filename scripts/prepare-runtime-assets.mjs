import { copyFile, mkdir, readFile } from "node:fs/promises";

const packageRoot = new URL("../node_modules/@arcgis/core/", import.meta.url);
const { version } = JSON.parse(
    await readFile(new URL("package.json", packageRoot), "utf8"),
);
const destination = new URL(
    `../public/runtime/arcgis-${version}/esri/geometry/support/`,
    import.meta.url,
);
await mkdir(destination, { recursive: true });
await copyFile(
    new URL("assets/esri/geometry/support/pe-wasm.wasm", packageRoot),
    new URL("pe-wasm.wasm", destination),
);
