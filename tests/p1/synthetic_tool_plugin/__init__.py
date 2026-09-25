def register(ctx):
    ctx.register_tool(
        name='p1_synthetic_expand', toolset='p1_synthetic',
        schema={'name': 'p1_synthetic_expand', 'description': 'Return local synthetic text.',
                'parameters': {'type': 'object', 'properties': {}, 'required': []}},
        handler=lambda args, **kwargs: 'P1_TOOL_RESULT ' + 'synthetic local data ' * 4000,
    )
