import gzip
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publisher', pathlib.Path(__file__).parents[1] / 'scripts/game_data_pack.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublisherTests(unittest.TestCase):
    def test_keeps_all_locations_and_moves_geometry_to_verified_separate_files(self):
        pack = {'schemaVersion': 1, 'name': 'Test', 'createdAt': '2026-11-08', 'bbox': [8, 47, 9, 48],
            'elements': [{'type': 'node', 'id': 1, 'lon': 8.5, 'lat': 47.5, 'tags': {'tourism': 'museum', 'name': 'Museum', 'irrelevant': 'removed'}}],
            'geometry': [{'type': 'way', 'id': 99, 'tags': {'highspeed': 'yes'}, 'geometry': [{'lon': 8.5, 'lat': 47.4}, {'lon': 8.6, 'lat': 47.6}]}]}
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory)
            manifest = publisher.publish(pack, output)
            for descriptor in [manifest, *manifest['assets']]:
                data = (output / descriptor['file']).read_bytes()
                self.assertEqual(len(data), descriptor['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(), descriptor['sha256'])
            core = json.loads(gzip.decompress((output / manifest['file']).read_bytes()))
            self.assertEqual([p['id'] for p in core['elements']], [1])
            self.assertNotIn('irrelevant', core['elements'][0]['tags'])
            self.assertNotIn('geometry', core['geometry'][0])
            self.assertEqual(core['geometry'][0]['bounds']['maxlat'], 47.6)
            shard = json.loads(gzip.decompress((output / manifest['assets'][0]['file']).read_bytes()))
            self.assertEqual(shard, pack['geometry'])


if __name__ == '__main__':
    unittest.main()
