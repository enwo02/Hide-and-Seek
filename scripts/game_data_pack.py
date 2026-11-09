"""Publish points separately from lazily loaded boundary geometry."""
import gzip
import hashlib
import json
import pathlib


def publish(pack, output, shard_size=32):
    output = pathlib.Path(output)
    output.mkdir(parents=True, exist_ok=True)
    assets = []
    essential_tags = {'tourism', 'amenity', 'natural', 'leisure', 'diplomatic', 'place',
        'brand:wikidata', 'railway', 'highway', 'aerialway', 'aeroway', 'iata',
        'population', 'platform', 'public_transport', 'subway', 'light_rail', 'name', 'network'}
    point_elements = [{**el, 'tags': {key: value for key, value in el.get('tags', {}).items()
        if key in essential_tags or key.startswith('name:')}} for el in pack['elements']]
    lines = pack.get('trainLines')
    if lines:
        station_ids = {s['id'] for s in lines['stations']}
        lines = {**lines, **{kind: [{**item,
            'tags': {key: value for key, value in item['tags'].items() if key in {'name', 'name:en', 'network'}},
            'nodes': [node for node in item['nodes'] if node in station_ids]}
            for item in lines[kind] if any(node in station_ids for node in item['nodes'])]
            for kind in ['ways', 'relations']}}

    def write(value, prefix):
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        payload = gzip.compress(raw, mtime=0)
        digest = hashlib.sha256(payload).hexdigest()
        name = f'{prefix}-{digest[:16]}.pack'
        temporary = output / (name + '.tmp')
        temporary.write_bytes(payload)
        temporary.replace(output / name)
        return {'file': name, 'bytes': len(payload), 'sha256': digest}

    originals = pack['geometry']
    by_id = {(el['type'], el['id']): el for el in originals}
    def coordinates(el, seen=None):
        seen = set() if seen is None else seen
        key = (el['type'], el['id'])
        if key in seen: return []
        seen.add(key)
        points = [(p['lon'], p['lat']) for p in el.get('geometry', []) if p]
        for member in el.get('members', []):
            points.extend((p['lon'], p['lat']) for p in member.get('geometry', []) if p)
            if member['type'] == 'relation' and ('relation', member['ref']) in by_id:
                points.extend(coordinates(by_id[('relation', member['ref'])], seen))
        return points

    index = []
    # Country outlines get their own file, so a country game needn't load city boundaries.
    countries = [el for el in originals if el.get('tags', {}).get('admin_level') == '2']
    rest = [el for el in originals if el not in countries]
    groups = [[country] for country in countries] + [rest[i:i + shard_size] for i in range(0, len(rest), shard_size)]
    for group in groups:
        asset = write(group, 'geometry')
        assets.append(asset)
        for el in group:
            points = coordinates(el)
            if not points: continue
            index.append({'type': el['type'], 'id': el['id'], 'tags': el.get('tags', {}), 'file': asset['file'],
                'bounds': {'minlon': min(p[0] for p in points), 'minlat': min(p[1] for p in points),
                           'maxlon': max(p[0] for p in points), 'maxlat': max(p[1] for p in points)}})
    core = {**pack, 'elements': point_elements, 'geometry': index, 'geometryAssets': [asset['file'] for asset in assets]}
    if lines: core['trainLines'] = lines
    main = write(core, 'switzerland')
    manifest = {'schemaVersion': 1, 'name': pack['name'], 'createdAt': pack['createdAt'], 'bbox': pack['bbox'],
        **main, 'assets': assets, 'totalBytes': main['bytes'] + sum(a['bytes'] for a in assets)}
    temporary = output / 'manifest.tmp'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    temporary.replace(output / 'manifest.json')
    print(f"Published {len(core['elements']):,} locations; {manifest['totalBytes']/1e6:.1f} MB total, "
          f"{main['bytes']/1e6:.1f} MB location pack; {len(assets)} geometry files loaded only when needed.", flush=True)
    return manifest


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pack', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('public/game-data'))
    args = parser.parse_args()
    payload = args.pack.read_bytes()
    if args.pack.suffix == '.gz': payload = gzip.decompress(payload)
    publish(json.loads(payload), args.output)
