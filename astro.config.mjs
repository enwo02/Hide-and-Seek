// @ts-check
import partytown from "@astrojs/partytown";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";
import { env } from "node:process";

const [pagesOwner, pagesRepository] = (
    env.GITHUB_REPOSITORY || "taibeled/JetLagHideAndSeek"
).split("/");

// https://astro.build/config
export default defineConfig({
    integrations: [
        react(),
        tailwind({
            applyBaseStyles: false,
        }),
        partytown({
            config: {
                forward: ["dataLayer.push"],
            },
        }),
        AstroPWA({
            workbox: {
                globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,geojson}"],
                globIgnores: ["game-data/**"],
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                runtimeCaching: [
                    {
                        urlPattern: /\/runtime\/arcgis-[^/]+\/.*\.wasm$/,
                        handler: "CacheFirst",
                        options: {
                            cacheName: "jlhs-map-generator-permanent-cache",
                        },
                    },
                ],
            },
            manifest: {
                name: "Jet Lag Hide and Seek Map Generator",
                short_name: "Map Generator",
                description:
                    "Automatically generate maps for Jet Lag The Game: Hide and Seek with ease! Simply name the questions and watch the map eliminate hundreds of possibilities in seconds.",
                icons: [
                    {
                        src: "JLIcon.png",
                        sizes: "1080x1080",
                        type: "image/png",
                    },
                    {
                        src: "android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                ],
                theme_color: "#1F2F3F",
            },
        }),
    ],
    devToolbar: {
        enabled: false,
    },
    site: `https://${pagesOwner}.github.io`,
    base: pagesRepository.endsWith(".github.io") ? "/" : `/${pagesRepository}/`,
});
