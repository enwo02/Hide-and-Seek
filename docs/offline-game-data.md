# Offline game data

This fork uses static regional data files and browser storage. Friends open the
website and choose **Options → Download Switzerland Data** once
on each phone. No application server is required. Background maps keep their
existing providers.

## Prepare or update the data once

The prepared files are in `public/game-data/`. To rebuild them on a laptop:

```sh
python3 -m venv .venv-game-data
.venv-game-data/bin/python -m pip install -r scripts/game-data-requirements.txt
.venv-game-data/bin/python scripts/prepare-bulk-game-data.py --surroundings
```

This downloads Geofabrik's Switzerland, Liechtenstein and adjacent French,
German, Italian and Austrian extracts. It verifies source checksums and processes
them locally. Large source downloads stay in `.game-data-cache/bulk/`; they are
not published. The final phone download contains only game locations, relevant
boundaries and station-line information.

Downloaded files and completed processing are checkpointed. Rerun the same command
to resume after an interruption. The old published manifest remains intact if a
build fails. Keep the generated cache locally to avoid repeating preparation.
Cached source snapshots are reused without network access. Add `--refresh-sources`
when you intentionally want updated data; ordinary reruns do not redownload it.

For Switzerland alone, omit `--surroundings`. For another region, use
`--regions` with Geofabrik Europe region paths and `--name`. `--bbox` limits the
output (default: west 5°, south 45°, east 11°, north 49°). Exact source coverage is
recorded separately, so a rectangle does not falsely imply coverage across an
undownloaded border. `--download-only` caches sources without processing them.
Local OSM/PBF files can be supplied with `--input` and a Geofabrik `.poly` file
with `--coverage`.

The input data comes from [Geofabrik](https://download.geofabrik.de/europe.html),
© OpenStreetMap contributors, under [ODbL](https://www.openstreetmap.org/copyright).
Keep the attribution and database licence when distributing the files.

## Publish and play

Publish the app together with **all files referenced by `public/game-data/manifest.json`**
on GitHub Pages. The existing deployment workflow builds the static app; the
site path automatically follows the GitHub repository name. Enable Pages using
GitHub Actions in the destination repository.

Each phone downloads the locations and geometry files, checking their sizes and
SHA-256 hashes. Only a complete download replaces the installed pack. Interrupted
downloads reuse already verified files on retry. Boundary files remain compressed
in browser storage and are decoded only when a question needs them. The app also
saves its geometry runtime and coastline file locally.

Reload after installing or changing a pack to discard old memoized answers.
The app requests persistent storage, but a browser may still remove website data.
Check the saved-data status and test the intended phone in airplane mode before
a game. Background map tiles and external sharing/import services need their
usual network access.

## Coverage and behaviour

- Local tentacles and nearest-place matching/measuring for all built-in POI categories.
- Airports, major cities, McDonald's, 7-Eleven and all default station/stop filters.
- Local country/canton/municipality outlines and administrative boundary lookup.
- High-speed rail geometry and same-train-line matching where the source data is complete.
- Local name search for downloaded boundaries and points.

Only searches wholly covered by the downloaded region use local answers. Queries
outside coverage, unsupported custom filters and incomplete source boundaries
retain online fallback. Incomplete boundary data never becomes an empty valid
answer. Some broad first-letter-of-zone searches can require online data when a
matching boundary extends beyond the source extracts.

Point locations for ways and relations use their bounding-box centres, as the
original app does. Local radius/zone inclusion tests those centres. Overpass can
also include a feature whose edge crosses a search boundary while its centre is
outside. This is a deliberate point-based interpretation. Results still depend
on OpenStreetMap's coverage and tagging; they are not an official location list
for the cards.

Tentacle Voronoi and polygon intersections run in a worker to keep the map usable.
Other question types still perform some geometry on the main thread. Category and
zone results are reused. Online fallback requests have deadlines, retry alternate
hosts and reject partial responses. Failed refreshes release loading controls.

## Validation

```sh
pnpm exec vitest run
.venv-game-data/bin/python -m unittest discover -s tests -p 'test_*.py'
pnpm build
```

Use Node 24, as required by the upstream app. On this laptop's Node 25, the build
works with `NODE_OPTIONS=--no-experimental-webstorage pnpm build`. Eight unmodified
upstream station tests fail here inside ArcGIS's WebAssembly loader (`require is
not defined`); this was reproduced against a clean upstream copy. Existing
upstream type errors are separate from the added data modules.

The prepared-pack test checks real file hashes, local museum lookup and the Swiss
country outline with network calls disabled. New unit tests cover incomplete
coverage, compressed downloads, lazy boundaries, station lines, online failures
and tentacle geometry. Real-phone performance and offline testing remain release
checks; desktop tests do not establish phone timing guarantees.
