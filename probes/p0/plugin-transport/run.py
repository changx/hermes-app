"""Run with the baseline .venv Python, from any cwd; no model or external network.

Copies the manifest into disposable HERMES_HOME, uses the unmodified Hermes
PluginManager and platform registry, and exercises the plugin via real TCP.
"""
import asyncio
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import secrets

BASELINE = Path("/opt/projects/jamie/_worktrees/hermes-agent/hermes-app-p0-baseline")
sys.path.insert(0, str(BASELINE))


def check(results, name, condition, detail):
    assert condition, f"{name}: {detail}"
    results.append({"check": name, "observed": detail})


async def exercise(results, home):
    from aiohttp import ClientSession, WSServerHandshakeError
    from gateway.config import PlatformConfig
    from gateway.platform_registry import platform_registry
    from hermes_cli.plugins import get_plugin_manager

    plugin_dir = home / "plugins" / "p0-transport-probe"
    plugin_dir.mkdir(parents=True)
    for filename in ("plugin.yaml", "__init__.py"):
        shutil.copy2(Path(__file__).parent / "fixture" / filename, plugin_dir / filename)
    config = home / "config.yaml"
    config.write_text("plugins:\n  enabled:\n    - p0-transport-probe\nbrowser:\n  extension_control:\n    enabled: true\n")
    owner_token, foreign_token = "synthetic-owner-p0", "synthetic-foreign-p0"
    owner = {"Authorization": f"Bearer {owner_token}"}
    foreign = {"Authorization": f"Bearer {foreign_token}"}
    manager = get_plugin_manager()
    adapter = None
    url = None
    try:
        manager.discover_and_load()
        item = next(p for p in manager.list_plugins() if p["key"] == "p0-transport-probe")
        entry = platform_registry.get("p0_transport_probe")
        check(results, "T01_manifest_register", item["enabled"] and not item["error"] and entry is not None,
              {"plugin": item["key"], "enabled": item["enabled"], "platform_registered": entry is not None})
        adapter = platform_registry.create_adapter("p0_transport_probe", PlatformConfig(
            enabled=True, extra={"tokens": {"owner": owner_token, "foreign": foreign_token}}))
        check(results, "T01_factory", adapter is not None and adapter.__class__.__name__ == "TransportProbeAdapter",
              {"adapter": type(adapter).__name__})
        check(results, "T01_connect", await adapter.connect(), {"connected": True})
        url = f"http://127.0.0.1:{adapter.port}"
        async with ClientSession(timeout=__import__("aiohttp").ClientTimeout(total=4), trust_env=False) as client:
            async def call(method, path, *, headers=owner, **kwargs):
                async with client.request(method, url + path, headers=headers, **kwargs) as response:
                    data = await response.read()
                    try:
                        payload = json.loads(data)
                    except ValueError:
                        payload = data.decode(errors="replace")[:80]
                    return response.status, payload

            status, payload = await call("GET", "/health")
            check(results, "T02_plugin_http", status == 200 and payload["scope"] == "owner",
                  {"status": status, "plugin": payload.get("plugin")})
            checks = []
            for headers in ({}, {"Authorization": "Bearer incorrect"}, foreign,
                            {**owner, "X-Profile": "foreign"}):
                s, _ = await call("GET", "/health", headers=headers)
                checks.append(s)
            check(results, "T03_http_auth_profile", checks == [401, 401, 403, 403],
                  {"missing_wrong_foreign_spoofed_profile": checks.copy()})
            for headers in ({}, {"Authorization": "Bearer incorrect"}, foreign,
                            {**owner, "X-Profile": "foreign"}):
                try:
                    async with client.ws_connect(url + "/ws", headers=headers):
                        raise AssertionError("unauthorized WS upgraded")
                except WSServerHandshakeError as exc:
                    checks.append(exc.status)
            check(results, "T03_ws_auth_profile", checks[4:] == [401, 401, 403, 403],
                  {"missing_wrong_foreign_spoofed_profile": checks[4:]})
            async with client.ws_connect(url + "/ws", headers=owner) as ws_a, client.ws_connect(
                    url + "/ws", headers=owner) as ws_b:
                s, ev = await call("POST", "/events", json={"body": "synthetic event"})
                a, b = await asyncio.wait_for(ws_a.receive_json(), 2), await asyncio.wait_for(ws_b.receive_json(), 2)
                check(results, "T04_dual_ws_fanout", s == 201 and ev == a == b and a["seq"] == 1,
                      {"post": s, "two_clients_seq": [a["seq"], b["seq"]]})
                await ws_b.close()
                s, _ = await call("POST", "/events", json={"body": "offline"})
                second = await asyncio.wait_for(ws_a.receive_json(), 2)
                check(results, "T04_remaining_online", s == 201 and second["seq"] == 2,
                      {"post": s, "remaining_seq": second["seq"]})
            async with client.ws_connect(url + "/ws", headers=owner) as resumed:
                await resumed.send_json({"since": 1})
                replay = await asyncio.wait_for(resumed.receive_json(), 2)
                check(results, "T04_reconnect_replay", replay == {"events": [{"seq": 2, "body": "offline"}],
                                                          "truncated": False}, replay)
            s, item = await call("POST", "/files", data=b"file", headers={**owner, "Content-Type": "text/plain",
                                                                         "X-Filename": "sample.txt"})
            key = item.get("id") if isinstance(item, dict) else None
            s_get, body = await call("GET", f"/files/{key}")
            check(results, "T05_upload_download", s == 201 and s_get == 200 and body == "file",
                  {"upload": s, "download": s_get, "body": body})
            cases = []
            for data, mime, name in ((b"x" * 17, "text/plain", "ok.txt"),
                                     (b"x", "application/octet-stream", "ok.txt"),
                                     (b"x", "text/plain", "../escape.txt"),
                                     (b"x", "text/plain", "..")):
                code, _ = await call("POST", "/files", data=data,
                                     headers={**owner, "Content-Type": mime, "X-Filename": name})
                cases.append(code)
            for headers in ({}, foreign, {**owner, "X-Profile": "foreign"}):
                code, _ = await call("GET", f"/files/{key}", headers=headers)
                cases.append(code)
            code, _ = await call("GET", "/files/not-a-real-id")
            cases.append(code)
            check(results, "T05_attachment_boundaries", cases == [413, 415, 400, 400, 401, 403, 403, 404],
                  {"size_type_traversal_dot_missing_foreign_profile_unknown": cases})
        # The adapter is runner-owned; unloading registrations alone is NOT a connection shutdown.
        await adapter.disconnect()
        try:
            async with ClientSession(timeout=__import__("aiohttp").ClientTimeout(total=1)) as client:
                await client.get(url + "/health", headers=owner)
                stopped = False
        except __import__("aiohttp").ClientConnectorError:
            stopped = True
        check(results, "T01_disconnect", stopped and not adapter._sockets and not adapter._files,
              {"listener_closed": stopped, "sockets": len(adapter._sockets), "files": len(adapter._files)})
        await exercise_core_api(results)
        config.write_text("plugins:\n  enabled: []\n")
        manager.discover_and_load(force=True)
        item = next(p for p in manager.list_plugins() if p["key"] == "p0-transport-probe")
        check(results, "T01_disable", not item["enabled"] and platform_registry.get("p0_transport_probe") is None,
              {"enabled": item["enabled"], "registered": False})
        config.write_text("plugins:\n  enabled:\n    - p0-transport-probe\n")
        manager.discover_and_load(force=True)
        check(results, "T01_reenable", platform_registry.get("p0_transport_probe") is not None,
              {"registered": True})
        # Distinct active HERMES_HOME must not inherit the owner plugin registration.
        second_home = home.parent / "profile-b"
        second_home.mkdir()
        second_home.joinpath("config.yaml").write_text("plugins:\n  enabled: []\n")
        os.environ["HERMES_HOME"] = str(second_home)
        other_manager = get_plugin_manager()
        try:
            other_manager.discover_and_load()
            isolated = platform_registry.get("p0_transport_probe") is None
        finally:
            other_manager.unload()
            os.environ["HERMES_HOME"] = str(home)
            assert get_plugin_manager() is manager
        check(results, "T03_registry_profile_isolation", isolated, {"foreign_profile_registered": not isolated})
        # Core RPC method table is not a public ctx registrar. This call only checks rejection,
        # not a real WS upgrade (ordinary WS transport was independently tested in transport.md).
        from tui_gateway import server
        response = server.handle_request({"jsonrpc": "2.0", "id": 77, "method": "app.probe.ping", "params": {}})
        check(results, "T06_core_rpc_not_registered", response.get("error", {}).get("code") == -32601,
              {"rpc_error_code": response.get("error", {}).get("code")})
    finally:
        if adapter is not None:
            await adapter.disconnect()
        manager.unload()


async def exercise_core_api(results):
    """Actual existing API server on an ephemeral loopback port; no model calls."""
    from aiohttp import ClientSession, ClientTimeout
    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter

    token = secrets.token_hex(32)  # synthetic, never written or printed
    adapter = APIServerAdapter(PlatformConfig(enabled=True, extra={
        "host": "127.0.0.1", "port": 0, "key": token}))
    try:
        started = await adapter.connect()
        check(results, "T02_existing_api_start", started, {"connected": started})
        port = adapter._site._server.sockets[0].getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        async with ClientSession(timeout=ClientTimeout(total=4), trust_env=False) as client:
            async def call(method, path, headers=None, **kwargs):
                async with client.request(method, base + path, headers=headers or {}, **kwargs) as r:
                    body = await r.read()
                    try:
                        data = json.loads(body)
                    except ValueError:
                        data = body
                    return r.status, data

            health, body = await call("GET", "/health")
            missing, _ = await call("GET", "/api/sessions")
            wrong, _ = await call("GET", "/api/sessions", {"Authorization": "Bearer wrong"})
            auth = {"Authorization": f"Bearer {token}"}
            plugin_missing, _ = await call("GET", "/p0/transport")
            plugin_wrong, _ = await call("GET", "/p0/transport", {"Authorization": "Bearer wrong"})
            plugin_ok, plugin_body = await call("GET", "/p0/transport", auth)
            check(results, "T02_plugin_on_existing_listener", (plugin_missing, plugin_wrong, plugin_ok) ==
                  (401, 401, 200) and plugin_body.get("via") == "register_platform_handler",
                  {"missing_wrong_authorized": [plugin_missing, plugin_wrong, plugin_ok]})
            ok, _ = await call("GET", "/api/sessions", auth)
            foreign, _ = await call("GET", "/p/foreign/api/sessions", auth)
            check(results, "T02_T03_existing_api_auth", health == 200 and body["status"] == "ok"
                  and (missing, wrong, ok, foreign) == (401, 401, 200, 404),
                  {"health_missing_wrong_ok_foreign_profile": [health, missing, wrong, ok, foreign]})
            # Browser-control artifact endpoint is NOT general conversation attachments.
            upload_headers = {**auth, "Content-Type": "text/plain", "X-Artifact-Filename": "sample.txt"}
            no_auth, _ = await call("POST", "/v1/artifacts/upload", {
                "Content-Type": "text/plain", "X-Artifact-Filename": "sample.txt"}, data=b"file")
            uploaded, receipt = await call("POST", "/v1/artifacts/upload", upload_headers, data=b"file")
            path = receipt.get("download_path", "") if isinstance(receipt, dict) else ""
            check(results, "T05_existing_artifact_upload", (no_auth, uploaded) == (401, 201)
                  and path.startswith("/v1/artifacts/download/"),
                  {"missing_auth": no_auth, "upload": uploaded, "download_path_present": bool(path)})
            get_status, get_body = await call("GET", path, auth)
            again, _ = await call("GET", path, auth)
            check(results, "T05_existing_artifact_one_shot", (get_status, get_body, again) == (200, b"file", 404),
                  {"download": get_status, "second_download": again})
            bad_type, _ = await call("POST", "/v1/artifacts/upload", {
                **auth, "Content-Type": "application/x-invalid", "X-Artifact-Filename": "sample.txt"}, data=b"x")
            check(results, "T05_existing_artifact_type", bad_type == 415, {"mime_rejection": bad_type})
    finally:
        await adapter.disconnect()


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("results.json")
    scratch = Path(os.environ["TMPDIR"])
    results = []
    with tempfile.TemporaryDirectory(prefix="hermes-app-transport-", dir=scratch) as root:
        home = Path(root) / "profile-a"
        home.mkdir()
        previous = {key: os.environ.get(key) for key in ("HOME", "HERMES_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME")}
        os.environ.update({"HOME": str(home), "HERMES_HOME": str(home),
                           "XDG_CONFIG_HOME": str(home / "xdg-config"), "XDG_DATA_HOME": str(home / "xdg-data")})
        try:
            asyncio.run(exercise(results, home))
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
    document = {"baseline": "2f16a1aa5a35feec496949abdef7ad51aea0e7ef",
                "assertions_passed": len(results), "checks": results, "temporary_home_removed": not Path(root).exists()}
    output.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"assertions_passed": len(results), "checks": [r["check"] for r in results],
                      "temporary_home_removed": document["temporary_home_removed"]}))


if __name__ == "__main__":
    main()
