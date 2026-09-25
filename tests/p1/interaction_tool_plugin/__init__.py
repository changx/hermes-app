import os
import time
from pathlib import Path


def _home():
    return Path(os.environ['HERMES_HOME'])


def _gate(args, **kwargs):
    (_home()/'gate-executed').write_text('executed')
    return 'approved synthetic tool'


def _hold(args, **kwargs):
    (_home()/'hold-entered').write_text('entered')
    deadline=time.monotonic()+30
    while not (_home()/'hold-release').exists() and time.monotonic()<deadline:
        from tools.interrupt import is_interrupted
        if is_interrupted():
            return 'interrupted before side effect'
        time.sleep(.02)
    from tools.interrupt import is_interrupted
    if (_home()/'hold-release').exists() and not is_interrupted():
        (_home()/'hold-side-effect').write_text('executed')
    return 'synthetic hold complete'


def _pre_tool_call(**kwargs):
    if kwargs.get('tool_name')=='p1_gate':
        return {'action':'approve','message':'Synthetic local approval','rule_key':'p1_gate'}


def register(ctx):
    ctx.register_hook('pre_tool_call',_pre_tool_call)
    for name,handler in (('p1_gate',_gate),('p1_hold',_hold)):
        ctx.register_tool(name=name,toolset='p1_interaction',
            schema={'name':name,'description':'Harmless local synthetic interaction fixture.',
                    'parameters':{'type':'object','properties':{},'required':[]}},handler=handler)
