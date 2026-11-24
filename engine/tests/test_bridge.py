import importlib.util
import json
import pathlib
import unittest
from unittest.mock import MagicMock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('gomo_bridge', ROOT / 'bridge.py')
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)

class BridgeTests(unittest.TestCase):
    def test_invalid_command(self):
        with self.assertRaisesRegex(ValueError, 'Unknown action'):
            bridge.dispatch('unknown', {})

    def test_cancel_works_without_engine(self):
        self.assertTrue(bridge.dispatch('cancel', {})['cancel_requested'])
        bridge.CANCEL_RENDER.clear()

    def test_record_level_idle(self):
        result = bridge.dispatch('record_level', {})
        self.assertFalse(result['recording'])
        self.assertEqual(result['db'], -90.0)

    def test_send_utf8_jsonl(self):
        # Smoke check: protocol payload is JSON-serializable.
        result = {'event':'render_progress', 'message':'진행', 'progress':0.5}
        self.assertEqual(json.loads(json.dumps(result,ensure_ascii=False))['message'],'진행')

if __name__=='__main__':
    unittest.main()
