"""Protocol smoke test with a fake composer package, NOT real FFmpeg/sounddevice."""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'bridge.py'


class WorkerProtocolTests(unittest.TestCase):
    def test_ping_and_validate_using_test_double(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = pathlib.Path(temp)
            module = repo / 'composer'
            module.mkdir()
            (module / '__init__.py').write_text('', encoding='utf8')
            (module / 'schema.py').write_text('''from pathlib import Path
class Project:
    def __init__(self, doc, base_dir):
        self.clips = [type('Clip', (), c)() for c in doc.get('clips', [])]
        self.version = 2
        self.base_dir = Path(base_dir)
        self.bgm = type('BGM', (), doc.get('bgm', {'file': None}))()
    @classmethod
    def from_dict(cls, doc, base_dir):
        return cls(doc, base_dir)
    def resolve(self, file):
        return self.base_dir / file if file else None
def load_project(path):
    return Project.from_dict({}, Path(path).parent)
''', encoding='utf8')
            process = subprocess.Popen([sys.executable, '-u', str(SCRIPT)], cwd=repo, stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf8')
            try:
                assert process.stdin and process.stdout
                for number, action, args in [(1, 'ping', {}), (2, 'validate', {
                    'base_dir':str(repo), 'project':{'clips':[{'file':'missing.png'}], 'bgm':{'file':None}}})]:
                    process.stdin.write(json.dumps({'id':number,'action':action,'args':args})+'\n')
                    process.stdin.flush()
                    reply = json.loads(process.stdout.readline())
                    self.assertEqual(reply['id'], number)
                    self.assertTrue(reply['ok'], reply)
                    if action == 'validate':
                        self.assertFalse(reply['result']['valid'])
                        self.assertIn('missing.png', reply['result']['issues'][0])
            finally:
                process.stdin.close()
                process.wait(timeout=5)
                if process.stdout:
                    process.stdout.close()
                if process.stderr:
                    process.stderr.close()


if __name__=='__main__':
    unittest.main()
