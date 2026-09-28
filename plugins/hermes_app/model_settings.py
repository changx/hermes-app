"""Authenticated, profile-local default model settings backed by native Hermes inventory/switching.

No session override is made here: the disk default is consulted on the next turn, while
existing session and channel selections keep their native precedence.
"""
from __future__ import annotations

import re
from pathlib import Path

from hermes_constants import get_hermes_home
from hermes_cli import inventory, model_switch
from hermes_cli.model_selection_guards import combined_selection_warning
from gateway.slash_commands_model import _model_switch_skew_guard

SCOPE = 'connected-default'
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z')
# Model IDs include vendor/model and local variant tags, but never CLI flags, whitespace,
# control characters, URL/query delimiters or anything that could become an option.
_MODEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9_./:+-]{0,255}\Z')


def _safe_model(value: object) -> bool:
    return (isinstance(value, str) and bool(_MODEL.fullmatch(value))
            and '--' not in value and '://' not in value and '//' not in value)


class InvalidSelection(Exception):
    pass


class SelectionUnavailable(Exception):
    pass


def validate_request(body: dict) -> tuple[str, str, bool]:
    if (set(body) - {'scope', 'provider', 'model', 'confirm_selection'}
            or body.get('scope') != SCOPE
            or not isinstance(body.get('provider'), str)
            or not isinstance(body.get('model'), str)
            or type(body.get('confirm_selection', False)) is not bool):
        raise InvalidSelection()
    provider, model = body['provider'], body['model']
    if (not _ID.fullmatch(provider) or '--' in provider or not _safe_model(model)):
        raise InvalidSelection()
    return provider, model, body.get('confirm_selection', False)


def _snapshot():
    ctx = inventory.load_picker_context()
    # A normal picker open uses cached catalogs; never explicitly refresh/probe all custom
    # endpoints or return the native rows (which include URL/auth metadata and key hints).
    native = inventory.build_model_options_payload(
        ctx, explicit_only=True, include_unconfigured=False, refresh=False)
    providers = []
    selected = {}
    for row in native['providers']:
        if not row.get('authenticated', True):
            continue  # Native current-provider skeleton without a working credential.
        slug = row.get('slug')
        if not isinstance(slug, str) or not _ID.fullmatch(slug):
            continue
        # Native custom row slugs may be bare while switch_model returns custom:<slug>.
        aliases = row.get('aliases') or []
        canonical = 'custom:' + slug if row.get('is_user_defined') and 'custom:' + slug in aliases else slug
        if not _ID.fullmatch(canonical):
            continue
        name = row.get('name')
        # A user-supplied label must not turn a URL or credential into response content.
        if (not isinstance(name, str) or not name or len(name) > 100
                or any(ord(c) < 32 or ord(c) == 127 for c in name)
                or '://' in name or '@' in name):
            name = canonical
        models = [m for m in row.get('models', []) if _safe_model(m)]

        if canonical in selected:
            continue
        selected[canonical] = set(models)
        providers.append({'id': canonical, 'name': name, 'models': models})
    return ctx, selected, {'scope': SCOPE,
                           'provider': ctx.current_provider if isinstance(ctx.current_provider, str)
                           and _ID.fullmatch(ctx.current_provider) else '',
                           'model': ctx.current_model if _safe_model(ctx.current_model) else '',
                           'providers': providers}


def options() -> dict:
    return _snapshot()[2]


def save(provider: str, model: str, confirmed: bool) -> dict:
    # Entire read-resolve-guard-write-readback unit runs under GatewayRunner's model lock.
    skew = _model_switch_skew_guard()
    if skew:
        raise SelectionUnavailable()
    ctx, selected, _ = _snapshot()
    # Catalog caches may be cold or incomplete. The configured provider is the
    # allowlist; native switching validates a typed model, not this cached list.
    if provider not in selected:
        raise InvalidSelection()
    result = model_switch.switch_model(
        raw_input=model, current_provider=ctx.current_provider,
        current_model=ctx.current_model, current_base_url=ctx.current_base_url,
        current_api_key='', is_global=True, explicit_provider=provider,
        user_providers=ctx.user_providers, custom_providers=ctx.custom_providers)
    if not result.success:
        raise SelectionUnavailable()
    # Native model aliases may resolve to a canonical ID on the selected route.
    if not _safe_model(result.new_model) or result.target_provider != provider:
        raise SelectionUnavailable()
    warning = combined_selection_warning(
        result.new_model, provider=result.target_provider, base_url=result.base_url or '',
        api_key=result.api_key or '', model_info=result.model_info)
    if warning is not None and not confirmed:
        return {'confirmation_required': True, 'warning': warning.message,
                'provider': provider, 'model': model}
    target = Path(get_hermes_home()) / 'config.yaml'
    model_switch.persist_model_selection(result, config_path=target)
    # Read native effective settings again; successful function return alone is not a save.
    _, _, response = _snapshot()
    if response['provider'] != provider or response['model'] != result.new_model:
        raise SelectionUnavailable()
    return {**response, 'effective': 'next-turn'}
