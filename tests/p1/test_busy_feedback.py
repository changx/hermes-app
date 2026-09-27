"""Persist only actual native busy replies for their exact input."""
import asyncio

import pytest
from hermes_app.adapter import HermesAppAdapter
from hermes_app.storage import Store

ACKS = [
    '⏩ Steered into current run (iteration 2/500). Your message arrives after the next tool call.',
    '⏩ Steered into current run and its active subagent(s). Your message arrives after their next tool call.',
    '↪ Redirected current run. I\'ll adjust using your correction.',
    '⏳ Queued for the next turn. I\'ll respond once the current task finishes.',
    '⏳ Subagent working — your message is queued for when it finishes (use /stop to cancel everything).',
    '⏳ Compressing context — your message is queued for when it finishes (use /stop to cancel everything).',
    '⚡ Interrupting current task. I\'ll respond to your message shortly.',
]


def setup(tmp_path):
    store=Store(tmp_path/'metadata.sqlite')
    thread=store.create_thread('p','test','s','')
    owner,_=store.accept(thread,'owner','first');store.claim_next(thread)
    follow,_=store.accept(thread,'follow','more');store.claim_busy_text(thread)
    app=object.__new__(HermesAppAdapter);app._store=store;app._events_changed=asyncio.Event()
    app._busy_feedback_targets={follow['id']:('p',thread)}
    return app,store,thread,owner,follow


@pytest.mark.parametrize('text', ACKS)
def test_native_feedback_is_independent_durable_and_exact(tmp_path,text):
    app,store,thread,owner,follow=setup(tmp_path)
    result=asyncio.run(app.send('p',text+'\n\nOne-time config hint',reply_to=follow['id']))
    assert result.success and app._events_changed.is_set()
    receipt=store.receipt(follow['id'])
    assert receipt['feedback']==text and receipt['processing'] is None
    assert 'feedback' not in store.receipt(owner['id'])
    before=store.sync_page()['events']
    asyncio.run(app.send('p',text,reply_to=follow['id']))
    assert store.sync_page()['events']==before
    store.mark_handed_off(follow['id']);store.finish_receipt(follow['id'],'received')
    assert Store(store.path).receipt(follow['id'])['feedback']==text
    assert store.accept(thread,'follow','more')[0]['feedback']==text



@pytest.mark.parametrize('case',['no-scope','other-reply','other-chat','ordinary-final','oversize'])
def test_no_feedback_inference_or_cross_message_capture(tmp_path,case):
    app,store,thread,owner,follow=setup(tmp_path)
    chat='p';reply=follow['id'];text=ACKS[0]
    if case=='no-scope':app._busy_feedback_targets={}
    elif case=='other-reply':reply=owner['id']
    elif case=='other-chat':chat='different'
    elif case=='ordinary-final':text='Normal model answer'
    elif case=='oversize':text+='x'*2000
    asyncio.run(app.send(chat,text,reply_to=reply))
    assert 'feedback' not in store.receipt(follow['id'])
    assert 'feedback' not in store.receipt(owner['id'])
