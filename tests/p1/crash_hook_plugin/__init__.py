import os
import signal
import time
from pathlib import Path


def _home():
    return Path(os.environ['HERMES_HOME'])


def marker_tool(args, **kwargs):
    with (_home()/'tool-marker').open('a') as stream:
        stream.write('called\n')
        stream.flush()
        os.fsync(stream.fileno())
    if os.environ.get('P1_COMPACT_CRASH') == '1':
        calls=(_home()/'tool-marker').read_text().count('called')
        return ('P1_TOOL_RESULT small' if calls==1 else
                'P1_TOOL_RESULT '+'synthetic local data '*4000)
    deadline=time.monotonic()+60
    while not (_home()/'tool-release').exists() and time.monotonic()<deadline:
        time.sleep(.02)
    return 'synthetic tool result'


def after_final(**kwargs):
    history=kwargs.get('conversation_history') or []
    if not any(isinstance(m,dict) and m.get('role')=='user' and
               m.get('content') in ('P1_FINAL_WINDOW','P1_COMPACT_FINAL_WINDOW') for m in history):
        return
    (_home()/'final-hook-marker').write_text('post_llm_call reached')
    os.kill(os.getpid(),signal.SIGSTOP)


def before_compaction(**kwargs):
    if os.environ.get('P1_COMPACT_CRASH') == '1' and kwargs.get('aux_task')=='compression':
        with (_home()/'compact-aux-marker').open('a') as stream:
            stream.write('compression\n')
            stream.flush();os.fsync(stream.fileno())


def register(ctx):
    ctx.register_hook('post_llm_call',after_final)
    ctx.register_hook('pre_auxiliary_call',before_compaction)
    ctx.register_tool(name='p1_marker',toolset='p1_crash',
                      schema={'name':'p1_marker','description':'Write local marker.',
                              'parameters':{'type':'object','properties':{},'required':[]}},
                      handler=marker_tool)
