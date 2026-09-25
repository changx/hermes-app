"""P1-02 plugin history gate from actual GatewayRunner hook observations.

The old raw core projector negatives remain in compression-*.json. They do not
decide whether plugin-owned original references work.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs' / 'p1' / 'evidence'
runner = json.loads((EVIDENCE / 'runner.json').read_text())
variants = {mode: json.loads((EVIDENCE / f'runner-{mode}.json').read_text())
            for mode in ('idle', 'rotate')}
raw = {mode: json.loads((EVIDENCE / f'compression-{mode}.json').read_text())
       for mode in ('inplace', 'rotate', 'idle', 'inplace_idle')}
preflight = json.loads((EVIDENCE / 'runner-preflight.json').read_text()) if (EVIDENCE / 'runner-preflight.json').exists() else {}
preflight_repeat = json.loads((EVIDENCE / 'runner-preflight-repeat.json').read_text()) if (EVIDENCE / 'runner-preflight-repeat.json').exists() else {}
midturn = json.loads((EVIDENCE / 'runner-midturn.json').read_text()) if (EVIDENCE / 'runner-midturn.json').exists() else {}
failed = json.loads((EVIDENCE / 'runner-failed.json').read_text()) if (EVIDENCE / 'runner-failed.json').exists() else {}
race = json.loads((EVIDENCE / 'runner-race.json').read_text()) if (EVIDENCE / 'runner-race.json').exists() else {}
v = runner.get('history_validation', {})
failures = []

def require(ok, label):
    if not ok:
        failures.append(label)

before = v.get('before', {}).get('messages', [])
compressed = v.get('compressed', {}).get('messages', [])
after = v.get('after_next', {}).get('messages', [])
page1 = v.get('page1', {})
page2 = v.get('page2', {})
branch = v.get('branch', {}).get('messages', [])
require(runner.get('history_status') == 200, 'plugin GET did not return 200')
require(runner.get('initial_description') is True and runner.get('second_turn_description_once') is True
        and runner.get('channel_change_new_thread_only') is True,
        'Channel Description was not limited to new user sessions')
require(runner.get('compaction_model_calls', 0) > 0 and runner.get('compaction_new_active_rows', 0) > 0,
        'real compaction did not rewrite active rows')
require(len(before) == 18 and before == compressed, 'original IDs/roles/text changed across compaction')
require(after[:len(before)] == before and len(after) == len(before)+2,
        'next turn did not append after original references')
require([m.get('id') for m in page1.get('messages', [])+page2.get('messages', [])] ==
        [m.get('id') for m in before[:4]] and page1.get('next_cursor'), 'bounded cursor pages differ')
require(v.get('cold', {}).get('messages') == after, 'cold metadata re-open differs')
require([(m.get('role'),m.get('text')) for m in before[:6]] == [
    ('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL'),
    ('user','P1_SECOND'),('assistant','SYNTHETIC_P1_FINAL'),
    ('user','P1_FIRST'),('assistant','SYNTHETIC_P1_FINAL')], 'repeated text order differs')
require(before[0].get('id') != before[4].get('id'), 'identical sends share an ID')
require([(m.get('role'),m.get('text')) for m in branch] == [
    ('user','P1_OTHER'),('assistant','SYNTHETIC_P1_FINAL')] and
    not {m.get('id') for m in branch} & {m.get('id') for m in after}, 'branch leaked into Thread')
require(runner.get('deleted_source_status') == 409, 'deleted original did not report unavailable')
for mode, item in variants.items():
    variant = item.get('history_validation', {})
    original = variant.get('before', {}).get('messages', [])
    later = variant.get('after_next', {}).get('messages', [])
    require(item.get('compaction_mode') == mode and item.get('compaction_model_calls', 0) > 0 and
            item.get('compaction_new_active_rows', 0) > 0, f'{mode}: compaction not observed')
    require(len(original) == len(before) and
            [(m.get('role'), m.get('text')) for m in original] ==
            [(m.get('role'), m.get('text')) for m in before] and
            variant.get('compressed', {}).get('messages') == original and
            later[:len(original)] == original and len(later) == len(original)+2,
            f'{mode}: plugin IDs/roles/text changed')
    require(variant.get('cold', {}).get('messages') == later and
            item.get('deleted_source_status') == 409,
            f'{mode}: cold reopen or missing original response differs')
    require([m.get('id') for m in variant.get('page1', {}).get('messages', []) +
             variant.get('page2', {}).get('messages', [])] == [m.get('id') for m in original[:4]],
            f'{mode}: bounded cursor differs')
    require(not {m.get('id') for m in variant.get('branch', {}).get('messages', [])} &
            {m.get('id') for m in later}, f'{mode}: branch leaked')
require(preflight.get('effective_threshold') == 2400 and preflight.get('summary_http_count',0) > 0
        and preflight.get('description_count_next_request',99) <= 1
        and preflight.get('inactive_core_rows',0) > 0 and preflight.get('cold_exact') is True,
        'automatic preflight compression and cold history not proven')
require(preflight.get('after_next',{}).get('messages',[])[:len(preflight.get('before',{}).get('messages',[]))]
        == preflight.get('before',{}).get('messages',[]) and bool(preflight.get('before',{}).get('messages')),
        'preflight original refs changed')
repeat = preflight_repeat.get('runs', [])
require(len(repeat) >= 2 and len({r.get('run_id') for r in repeat}) == len(repeat)
        and all(r.get('summary_http_count',0) > 0 and r.get('cold_exact') is True
                and r.get('prefix_exact') is True and r.get('settled') is True
                and r.get('description_count_next_request',99) <= 1
                and r.get('after_count') == r.get('before_count',0)+2 for r in repeat),
        'repeated automatic preflight runs did not settle with exact cold original history')
require(midturn.get('tool_called') is True and midturn.get('handler_called') is True
        and midturn.get('summary_http_count',0) > 0 and midturn.get('inactive_core_rows',0) > 0
        and midturn.get('history_exact') is True and midturn.get('bounded_pages_exact') is True
        and midturn.get('cold_exact') is True and midturn.get('branch_excluded') is True
        and midturn.get('description_init_once') is True,
        'automatic midturn compression through a real tool loop not proven')
require(any(m.get('text') == 'P1_FAIL' and m.get('role') == 'user'
            for m in failed.get('page',{}).get('messages',[]))
        and any(m.get('role') == 'assistant' and 'not processed' in m.get('text','')
                for m in failed.get('page',{}).get('messages',[]))
        and bool(failed.get('page',{}).get('turn_outcomes'))
        and not failed.get('page',{}).get('incomplete_turns'),
        'failed GatewayRunner turn user row and outcome not visible')
require(race.get('busy_after_post_hook') is True and race.get('second_send_status') == 409
        and race.get('after_release_exact') is True and not race.get('after',{}).get('incomplete_turns'),
        'fast second send entered gateway before owner task completion')
record = {'gate':'P1-02 complete history lifecycle','passed':not failures,'failures':failures,
          'raw_core_projector_negatives':{mode:not x['canonical_visible_equal'] for mode,x in raw.items()},
          'scope':'real isolated GatewayRunner in-place, idle, rotation, repeated preflight, post-tool compression, early failure and held post-hook race'}
(EVIDENCE/'gate.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(record,ensure_ascii=False))
if failures:
    raise SystemExit(1)
