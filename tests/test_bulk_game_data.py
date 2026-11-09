import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
import hashlib

try:
    import osmium
    import shapely
    from shapely.geometry import box
    sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / 'scripts'))
    spec = importlib.util.spec_from_file_location('bulk', pathlib.Path(__file__).parents[1] / 'scripts/prepare-bulk-game-data.py')
    bulk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bulk)
except ImportError:
    bulk = None


@unittest.skipIf(bulk is None, 'Install the optional bulk preparation dependencies')
class BulkTests(unittest.TestCase):
    def test_verified_sources_are_reused_without_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = pathlib.Path(directory)
            path = cache / 'switzerland.osm.pbf'
            path.write_bytes(b'cached source')
            (cache / 'switzerland.osm.pbf.md5').write_text(hashlib.md5(b'cached source').hexdigest())
            (cache / 'switzerland.poly').write_text('test\n1\n0 0\n1 0\n1 1\n0 1\n0 0\nEND\nEND')
            with patch.object(bulk.requests, 'Session', side_effect=AssertionError('Network disabled')):
                result, coverage = bulk.download_region('switzerland', cache)
            self.assertEqual(result, path)
            self.assertEqual(coverage.area, 1)
    def test_extracts_points_full_boundaries_and_station_line_memberships(self):
        xml = '''<osm version="0.6">
        <node id="1" lat="47" lon="8"><tag k="tourism" v="museum"/><tag k="name" v="Museum"/></node>
        <node id="2" lat="47" lon="8.01"/><node id="3" lat="47.01" lon="8.01"/><node id="4" lat="47.01" lon="8"/>
        <node id="5" lat="47.005" lon="8.005"><tag k="railway" v="station"/></node>
        <node id="6" lat="47.006" lon="8.006"><tag k="railway" v="station"/></node>
        <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="amenity" v="hospital"/></way>
        <way id="11"><nd ref="5"/><nd ref="6"/><tag k="railway" v="rail"/><tag k="name" v="Test Line"/></way>
        <relation id="20"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/><tag k="boundary" v="administrative"/><tag k="admin_level" v="8"/></relation>
        <relation id="21"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/><tag k="tourism" v="zoo"/></relation>
        <relation id="30"><member type="node" ref="5" role="stop"/><member type="node" ref="6" role="stop"/><tag k="name" v="Test Line"/></relation>
        </osm>'''
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'fixture.osm'
            path.write_text(xml)
            points, geometry, incomplete, lines, incomplete_geometry = bulk.build([path], box(7.9, 46.9, 8.2, 47.2))
        self.assertEqual({p['id'] for p in points}, {1, 5, 6, 10, 21})
        center = next(p['center'] for p in points if p['id'] == 10)
        self.assertAlmostEqual(center['lon'], 8.005)
        self.assertAlmostEqual(center['lat'], 47.005)
        self.assertEqual(next(g for g in geometry if g['id'] == 20)['members'][0]['geometry'][0], {'lon': 8.0, 'lat': 47.0})
        self.assertEqual(incomplete, [])
        self.assertEqual(lines['ways'][0]['nodes'], [5, 6])
        self.assertEqual(lines['relations'][0]['id'], 30)

    def test_coverage_polygon_preserves_holes(self):
        poly = 'test\n1\n0 0\n4 0\n4 4\n0 4\n0 0\nEND\n!1\n1 1\n2 1\n2 2\n1 2\n1 1\nEND\nEND'
        self.assertEqual(bulk.read_poly(poly).area, 15)


if __name__ == '__main__':
    unittest.main()
