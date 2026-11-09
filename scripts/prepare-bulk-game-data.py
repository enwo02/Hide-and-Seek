#!/usr/bin/env python3
"""Build static game data from Geofabrik extracts, without Overpass requests.

Requires: pip install osmium shapely requests
"""
import argparse
import gzip
import hashlib
import json
import pathlib
import pickle
import time

import osmium
import requests
from game_data_pack import publish
from shapely.geometry import Point, Polygon, box, mapping
from shapely.ops import unary_union

POINT_TAGS = {
    'tourism': {'aquarium', 'museum', 'theme_park', 'zoo'},
    'amenity': {'hospital', 'cinema', 'library', 'ferry_terminal'},
    'natural': {'peak'}, 'leisure': {'park', 'golf_course'},
    'diplomatic': {'consulate'}, 'place': {'city'},
    'brand:wikidata': {'Q38076', 'Q259340'},
    'railway': {'station', 'halt', 'stop', 'tram_stop', 'funicular'},
    'highway': {'bus_stop'}, 'aerialway': {'station'},
}


def wanted(tags):
    return (any(value in POINT_TAGS.get(key, ()) for key, value in tags.items())
            or (tags.get('aeroway') == 'aerodrome' and 'iata' in tags)
            or (tags.get('public_transport') == 'platform' and tags.get('platform') == 'ferry'))


def read_poly(text):
    lines = iter(text.strip().splitlines()[1:])
    polygons = []
    for line in lines:
        name = line.strip()
        if name == 'END':
            break
        ring = []
        for line in lines:
            if line.strip() == 'END':
                break
            ring.append(tuple(map(float, line.split())))
        if name.startswith('!'):
            polygons[-1][1].append(ring)
        else:
            polygons.append((ring, []))
    return unary_union([Polygon(outer, holes) for outer, holes in polygons])


def md5(path):
    digest = hashlib.md5()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def download_region(region, cache, refresh=False):
    if not all(part.replace('-', '').isalnum() for part in region.split('/')):
        raise ValueError('Invalid Geofabrik region name')
    base = f'https://download.geofabrik.de/europe/{region}'
    path = cache / (region.replace('/', '-') + '.osm.pbf')
    marker = path.with_name(path.name + '.md5')
    poly_path = cache / (region.replace('/', '-') + '.poly')
    if not refresh and path.exists() and marker.exists() and poly_path.exists():
        checksum = marker.read_text().split()[0]
        if md5(path) == checksum:
            print(f'Using verified cached {region} source', flush=True)
            return path, read_poly(poly_path.read_text())
    session = requests.Session()
    session.headers['User-Agent'] = 'HideSeekRegionalPack/1.0'
    checksum_response = session.get(base + '-latest.osm.pbf.md5', timeout=60)
    checksum_response.raise_for_status()
    checksum = checksum_response.text.split()[0]
    if len(checksum) != 32 or any(c not in '0123456789abcdef' for c in checksum):
        raise ValueError('Invalid source checksum')
    if not path.exists() or md5(path) != checksum:
        partial = path.with_suffix('.pbf.partial')
        marker = partial.with_suffix('.md5')
        if marker.exists() and marker.read_text() != checksum:
            partial.unlink(missing_ok=True)
        marker.write_text(checksum)
        offset = partial.stat().st_size if partial.exists() else 0
        if offset and md5(partial) == checksum:
            partial.replace(path)
            return download_region(region, cache, refresh=True)
        print(f'Downloading {region} (resuming at {offset / 1e6:.1f} MB)…', flush=True)
        headers = {'Range': f'bytes={offset}-'} if offset else {}
        with session.get(base + '-latest.osm.pbf', headers=headers, stream=True, timeout=(30, 120)) as response:
            response.raise_for_status()
            if offset and response.status_code != 206:
                offset = 0
            downloaded = offset
            last_report = offset
            with partial.open('ab' if offset else 'wb') as file:
                for chunk in response.iter_content(1024 * 1024):
                    file.write(chunk)
                    downloaded += len(chunk)
                    if downloaded - last_report >= 25 * 1024 * 1024:
                        print(f'  {region}: {downloaded / 1e6:.0f} MB', flush=True)
                        last_report = downloaded
        if md5(partial) != checksum:
            partial.unlink(missing_ok=True)
            raise RuntimeError('Source changed or download damaged. Rerun to download the current snapshot.')
        partial.replace(path)
    print(f'Verified {region} source checksum', flush=True)
    poly_response = session.get(base + '.poly', timeout=60)
    poly_response.raise_for_status()
    poly_path.write_text(poly_response.text)
    marker.write_text(checksum)
    return path, read_poly(poly_response.text)


def build(paths, coverage, cache=None):
    relations = {}
    selected_relations = set()
    geometry_relations = set()
    needed_ways, needed_nodes = set(), set()
    ways, nodes, elements, geometry = {}, {}, {}, {}
    station_nodes, station_ways = {}, {}

    class Metadata(osmium.SimpleHandler):
        def relation(self, relation):
            tags = dict(relation.tags)
            relations[relation.id] = (tags, [(m.type, m.ref, m.role) for m in relation.members])
            if wanted(tags):
                selected_relations.add(relation.id)
            if (tags.get('boundary') == 'administrative' and tags.get('admin_level') in {str(n) for n in range(2, 11)}) or tags.get('highspeed') == 'yes':
                geometry_relations.add(relation.id)

    for path in paths:
        print(f'Reading relation references: {path.name}', flush=True)
        Metadata().apply_file(str(path))

    visited = set()
    def collect(relation_id):
        if relation_id in visited or relation_id not in relations:
            return
        visited.add(relation_id)
        for kind, ref, _ in relations[relation_id][1]:
            if kind == 'w': needed_ways.add(ref)
            elif kind == 'n': needed_nodes.add(ref)
            elif kind == 'r': collect(ref)
    for relation_id in selected_relations | geometry_relations:
        collect(relation_id)

    poi_ways = set()
    def collect_poi_ways(relation_id, seen):
        if relation_id in seen or relation_id not in relations: return
        seen.add(relation_id)
        for kind, ref, _ in relations[relation_id][1]:
            if kind == 'w': poi_ways.add(ref)
            elif kind == 'r': collect_poi_ways(ref, seen)
    seen = set()
    for relation_id in selected_relations:
        collect_poi_ways(relation_id, seen)
    boundary_extent = coverage.envelope.buffer(0.25)
    checkpoint = None
    completed = 0
    if cache:
        signature = hashlib.sha256(json.dumps([(str(p.resolve()), p.stat().st_size, p.stat().st_mtime_ns) for p in paths]).encode() + coverage.wkb + b'processing-profile-2').hexdigest()
        checkpoint = cache / f'processed-{signature}.pickle'
        if checkpoint.exists():
            with checkpoint.open('rb') as file: state = pickle.load(file)
            ways, nodes, elements, geometry, station_nodes, station_ways, completed = state
            print(f'Resuming after {completed}/{len(paths)} processed extracts', flush=True)

    def put_point(kind, object_id, tags, bounds):
        west, south, east, north = bounds
        center = {'lon': (west + east) / 2, 'lat': (south + north) / 2}
        if not coverage.covers(Point(center['lon'], center['lat'])):
            return
        element = {'type': kind, 'id': object_id, 'tags': tags}
        element.update(center if kind == 'node' else {'center': center})
        elements[f'{kind}/{object_id}'] = element

    class TaggedNodes(osmium.SimpleHandler):
        def node(self, node):
            if len(node.tags):
                tags = dict(node.tags)
                if tags.get('railway') == 'station': station_nodes[node.id] = {'id': node.id, 'lon': node.lon, 'lat': node.lat}
                if wanted(tags): put_point('node', node.id, tags, (node.lon, node.lat, node.lon, node.lat))

    class Locations(osmium.SimpleHandler):
        def way(self, way):
            tags = dict(way.tags)
            if any(key in tags for key in ('name', 'name:en', 'network')):
                refs = [n.ref for n in way.nodes]
                if any(ref in station_nodes for ref in refs):
                    station_ways[way.id] = {'id': way.id, 'tags': tags, 'nodes': refs}
            point = wanted(tags) if len(tags) else False
            highspeed = tags.get('highspeed') == 'yes'
            if way.id not in needed_ways and not point and not highspeed:
                return
            coordinates = [(n.lon, n.lat) for n in way.nodes if n.location.valid()]
            if not coordinates:
                return
            if len(coordinates) != len(way.nodes):
                raise RuntimeError(f'Incomplete way {way.id}; add the neighbouring source extract.')
            if way.id in needed_ways and (way.id in poi_ways or box(*coordinate_bounds(coordinates)).intersects(boundary_extent)):
                ways[way.id] = coordinates
            if point:
                put_point('way', way.id, dict(tags), coordinate_bounds(coordinates))
            if highspeed and box(*coordinate_bounds(coordinates)).intersects(coverage):
                geometry[f'way/{way.id}'] = {'type': 'way', 'id': way.id, 'tags': dict(tags),
                    'geometry': [{'lon': lon, 'lat': lat} for lon, lat in coordinates]}

    for index, path in enumerate(paths):
        if index < completed: continue
        print(f'Reading named locations: {path.name}', flush=True)
        TaggedNodes().apply_file(str(path), filters=[osmium.filter.EmptyTagFilter()])
        print(f'Reading way geometry: {path.name}', flush=True)
        location_index = osmium.index.create_map('flex_mem')
        locations = osmium.NodeLocationsForWays(location_index)
        locations.ignore_errors()
        with osmium.io.Reader(str(path)) as reader:
            osmium.apply(reader, locations, Locations())
        for node_id in needed_nodes:
            try:
                location = location_index.get(node_id)
                if location.valid(): nodes[node_id] = (location.lon, location.lat)
            except KeyError:
                pass
        del locations, location_index
        if checkpoint:
            temporary = checkpoint.with_suffix('.tmp')
            with temporary.open('wb') as file:
                pickle.dump((ways, nodes, elements, geometry, station_nodes, station_ways, index + 1), file, protocol=5)
            temporary.replace(checkpoint)
        print(f'Processed {index + 1}/{len(paths)} extracts; {len(elements):,} point locations so far', flush=True)

    def relation_coordinates(relation_id, seen=None):
        seen = set() if seen is None else seen
        if relation_id in seen or relation_id not in relations:
            return []
        seen.add(relation_id)
        coordinates = []
        for kind, ref, _ in relations[relation_id][1]:
            if kind == 'w': coordinates.extend(ways.get(ref, []))
            elif kind == 'n' and ref in nodes: coordinates.append(nodes[ref])
            elif kind == 'r': coordinates.extend(relation_coordinates(ref, seen))
        return coordinates

    def point_relation_complete(relation_id, seen=None):
        seen = set() if seen is None else seen
        if relation_id in seen: return True
        if relation_id not in relations: return False
        seen.add(relation_id)
        for kind, ref, _ in relations[relation_id][1]:
            if kind == 'w' and ref not in ways: return False
            if kind == 'n' and ref not in nodes: return False
            if kind == 'r' and not point_relation_complete(ref, seen): return False
        return True

    for relation_id in selected_relations:
        coordinates = relation_coordinates(relation_id)
        if not coordinates:
            continue
        if not point_relation_complete(relation_id):
            if box(*coordinate_bounds(coordinates)).intersects(coverage):
                raise RuntimeError(f'Incomplete point relation {relation_id} touches the requested area; add neighbouring extracts or reduce --bbox.')
            continue
        put_point('relation', relation_id, relations[relation_id][0], coordinate_bounds(coordinates))

    incomplete_boundaries = []
    incomplete_geometry = []
    def materialize(relation_id, seen=None):
        key = f'relation/{relation_id}'
        if key in geometry:
            return True
        seen = set() if seen is None else seen
        if relation_id in seen or relation_id not in relations:
            return False
        seen.add(relation_id)
        tags, references = relations[relation_id]
        members = []
        for kind, ref, role in references:
            if kind == 'w':
                if ref not in ways: return False
                members.append({'type': 'way', 'ref': ref, 'role': role,
                    'geometry': [{'lon': lon, 'lat': lat} for lon, lat in ways[ref]]})
            elif kind == 'n':
                if ref in nodes:
                    lon, lat = nodes[ref]
                    members.append({'type': 'node', 'ref': ref, 'role': role, 'lon': lon, 'lat': lat})
            elif kind == 'r':
                if not materialize(ref, seen): return False
                members.append({'type': 'relation', 'ref': ref, 'role': role})
        geometry[key] = {'type': 'relation', 'id': relation_id, 'tags': tags, 'members': members}
        return True
    for relation_id in geometry_relations:
        coordinates = relation_coordinates(relation_id)
        if coordinates and box(*coordinate_bounds(coordinates)).intersects(coverage):
            if not materialize(relation_id):
                incomplete_boundaries.append(relation_id)
                incomplete_geometry.append({'id': relation_id, 'tags': relations[relation_id][0]})
    station_relations = []
    for relation_id, (tags, members) in relations.items():
        refs = [ref for kind, ref, _ in members if kind == 'n']
        if any(ref in station_nodes for ref in refs):
            station_relations.append({'id': relation_id, 'tags': tags, 'nodes': refs})
    train_lines = {'stations': [s for s in station_nodes.values() if coverage.covers(Point(s['lon'], s['lat']))],
        'ways': list(station_ways.values()), 'relations': station_relations}
    print(f'Prepared {len(elements):,} locations and {len(geometry):,} geometries; {len(incomplete_boundaries)} boundary relations cross the source coverage and were omitted.', flush=True)
    return list(elements.values()), list(geometry.values()), incomplete_boundaries, train_lines, incomplete_geometry


def coordinate_bounds(coordinates):
    return (min(p[0] for p in coordinates), min(p[1] for p in coordinates),
            max(p[0] for p in coordinates), max(p[1] for p in coordinates))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--regions', nargs='+', default=['switzerland'], help='Geofabrik Europe region paths; add neighbours as desired')
    parser.add_argument('--surroundings', action='store_true', help='Include nearby French, German, Italian, Austrian and Liechtenstein extracts')
    parser.add_argument('--download-only', action='store_true', help='Cache and verify source extracts without processing them yet')
    parser.add_argument('--refresh-sources', action='store_true', help='Explicitly replace cached snapshots with the latest source data')
    parser.add_argument('--input', nargs='+', type=pathlib.Path, help='Use local OSM/PBF files instead of downloading')
    parser.add_argument('--coverage', type=pathlib.Path, help='Geofabrik .poly for local inputs')
    parser.add_argument('--bbox', default='5,45,11,49')
    parser.add_argument('--name', default='Switzerland')
    parser.add_argument('--cache', type=pathlib.Path, default=pathlib.Path('.game-data-cache/bulk'))
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('public/game-data'))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.surroundings:
        args.regions = ['switzerland', 'liechtenstein', 'france/alsace', 'france/franche-comte',
            'france/rhone-alpes', 'germany/baden-wuerttemberg', 'italy/nord-ovest', 'italy/nord-est', 'austria']
        if args.name == 'Switzerland': args.name = 'Switzerland and surrounding area'
    if args.input:
        if not args.coverage: parser.error('--input requires --coverage')
        paths, polygons = args.input, [read_poly(args.coverage.read_text())]
    else:
        sources = [download_region(region, args.cache, args.refresh_sources) for region in args.regions]
        paths, polygons = [s[0] for s in sources], [s[1] for s in sources]
    if args.download_only: return
    bounds = list(map(float, args.bbox.split(',')))
    if len(bounds) != 4 or not (-180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90): parser.error('Invalid bounding box')
    coverage = unary_union(polygons).intersection(box(*bounds))
    if coverage.is_empty: parser.error('Source coverage does not intersect the requested region')
    elements, geometry, incomplete, train_lines, incomplete_geometry = build(paths, coverage, args.cache)
    source_dates = []
    for path in paths:
        with osmium.io.Reader(str(path)) as reader:
            timestamp = reader.header().get('osmosis_replication_timestamp')
            if timestamp: source_dates.append(timestamp)
    pack = {'schemaVersion': 1, 'name': args.name, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'bbox': list(coverage.bounds), 'coverage': {'type': 'Feature', 'properties': {}, 'geometry': mapping(coverage)},
        'boundaries': True, 'highspeed': True, 'incompleteBoundaries': incomplete,
        'trainLines': train_lines,
        'sourceDates': sorted(set(source_dates)),
        'incompleteGeometry': incomplete_geometry,
        'attribution': '© OpenStreetMap contributors; ODbL 1.0', 'source': 'https://download.geofabrik.de/',
        'elements': elements, 'geometry': geometry}
    publish(pack, args.output)


if __name__ == '__main__':
    main()
