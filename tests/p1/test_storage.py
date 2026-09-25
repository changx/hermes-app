"""P1-01/02 contract tests; run against the pinned Hermes baseline interpreter."""
import importlib.util
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[2] / 'plugins' / 'hermes_app'
sys.path.insert(0, str(PLUGIN.parent))
from hermes_app.storage import Store


def test_new_session_description_once_and_thread_isolation(tmp_path):
    store = Store(tmp_path / 'app.sqlite')
    a = store.create_thread('project', 'a', 'root-a', 'Description v1')
    b = store.create_thread('project', 'b', 'root-b', 'Description v2')
    assert store.take_initial_description('root-a') == 'Description v1'
    assert store.take_initial_description('root-a') == ''
    assert store.take_initial_description('successor-a') == ''
    assert store.take_initial_description('root-b') == 'Description v2'
    assert store.get_thread(a)['session_id'] == 'root-a'
    assert store.get_thread(b)['session_id'] == 'root-b'
    store.close()
    reopened = Store(tmp_path / 'app.sqlite')
    assert reopened.take_initial_description('root-a') == ''
    assert reopened.get_thread(a)['description'] == 'Description v1'
    reopened.close()
