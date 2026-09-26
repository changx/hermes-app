#!/usr/bin/env python3
"""Admin-only pairing operations. Run locally with HERMES_APP_TOKEN in the environment.

Never put the administrator credential in arguments or URLs. This command does
not read another profile automatically. Normal App users do not run this tool.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description='Hermes App administrator device pairing')
    parser.add_argument('--base', required=True, help='HTTPS origin; local loopback HTTP allowed for isolated tests')
    commands = parser.add_subparsers(dest='operation', required=True)
    commands.add_parser('grant', help='Create a one-time, five-minute device pairing code')
    commands.add_parser('devices', help='List authorized devices (never their credentials)')
    revoke = commands.add_parser('revoke', help='Revoke one explicitly identified device')
    revoke.add_argument('device_id')
    args = parser.parse_args()
    base = args.base.rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment
            or (parsed.scheme == 'http' and parsed.hostname not in ('127.0.0.1', '::1'))):
        parser.error('base must be an HTTPS origin (or loopback HTTP for isolated testing)')
    token = os.environ.get('HERMES_APP_TOKEN', '')
    if len(token) < 32 or '\r' in token or '\n' in token:
        parser.error('administrator environment credential is missing or invalid')
    if args.operation == 'grant':
        method, route, data = 'POST', '/v1/pairing/grants', b'{}'
    elif args.operation == 'devices':
        method, route, data = 'GET', '/v1/pairing/devices', None
    else:
        if not re.fullmatch(r'[0-9a-f]{24}', args.device_id):
            parser.error('invalid device identifier')
        method, route, data = 'DELETE', '/v1/pairing/devices/' + args.device_id, None
    request = urllib.request.Request(base + route, data=data, method=method,
                                     headers={'Authorization': 'Bearer ' + token,
                                              'Content-Type': 'application/json',
                                              'User-Agent': 'HermesAppAdmin/0.1'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            raw = response.read(16384)
            if method == 'DELETE':
                print('Device revoked.')
            else:
                body = json.loads(raw)
                if args.operation == 'grant':
                    print(json.dumps({'code': body['code'], 'expires_at': body['expires_at']}, ensure_ascii=False))
                else:
                    print(json.dumps({'devices': body['devices']}, ensure_ascii=False))
    except urllib.error.HTTPError as exc:
        print(f'Pairing administration failed: HTTP {exc.code}', file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError):
        print('Pairing administration could not be completed; no credentials were printed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
