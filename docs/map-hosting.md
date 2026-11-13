# Map hosting

GitHub Pages serves the app. The `hide-and-seek-maps` Cloudflare Worker serves
public basemap and offline data from the private R2 bucket of the same name.
Deploy the Worker with `npx wrangler deploy --config map-worker/wrangler.jsonc`.

## Add a country

1. Prepare a PMTiles archive, its coverage polygon, and a regional game-data
   pack with a manifest. Use a versioned archive name and content-hashed pack
   filenames. The offline installer checks each file against the manifest.
2. Upload the archive to `<country-code>/<archive>.pmtiles` and the pack files
   to `<country-code>/game-data/`. Use lowercase two-letter country codes.
   Publish `manifest.json` after all its files are present. For large archives
   use an [S3-compatible multipart upload](https://developers.cloudflare.com/r2/objects/upload-objects/).
   Set long-lived cache headers on versioned files and a short lifetime on the
   manifest.
3. Add the country code, display name, coverage polygon and URLs to
   `src/maps/regions.ts`. The app uses the selected game's country to choose
   the basemap and regional download. The offline installer keeps one regional
   pack at a time.
4. Check that a `Range: bytes=0-16383` request to the archive returns `206`
   and the expected `Content-Range`. Check the hosted manifest and download
   from the app before releasing the change.
