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
    deadline=time.monotonic()+60
    while not (_home()/'tool-release').exists() and time.monotonic()<deadline:
        time.sleep(.02)
    return 'synthetic tool result'


def after_final(**kwargs):
    history=kwargs.get('conversation_history') or []
    if not any(isinstance(m,dict) and m.get('role')=='user' and
               m.get('content')=='P1_FINAL_WINDOW' for m in history):
        return
    (_home()/'final-hook-marker').write_text('post_llm_call reached')
    os.kill(os.getpid(),signal.SIGSTOP)


def register(ctx):
    ctx.register_hook('post_llm_call',after_final)
    ctx.register_tool(name='p1_marker',toolset='p1_crash',
                      schema={'name':'p1_marker','description':'Write local marker.',
                              'parameters':{'type':'object','properties':{},'required':[]}},
                      handler=marker_tool)
