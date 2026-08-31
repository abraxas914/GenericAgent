"""Tests for desktop_bridge.py upload limits and path-safety logic.

Path-only cases retain their lightweight mirrors; upload-limit cases exercise
the production decoder and real aiohttp handler.
Run: pytest frontends/tests/test_bridge_uploads.py -v
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import re
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from frontends.tests.test_bridge_sessions import _mod as bridge


# Mirrors desktop_bridge._safe_session_dir
def _safe_session_dir(sid: str | None) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]", "", str(sid or ""))
    return s or "_misc"


# Mirrors desktop_bridge._session_upload_dir
def _session_upload_dir(upload_root: Path, sid: str) -> Path:
    return upload_root / _safe_session_dir(sid)


# Mirrors the upload_handler naming/path rules.
def _build_upload_path(upload_root: Path, sid: str, name: str, token: str) -> Path:
    safe_name = (name or "file").strip().replace("/", "_").replace("\\", "_") or "file"
    return _session_upload_dir(upload_root, sid) / f"{token}__{safe_name}"


# Mirrors upload_delete_handler path whitelist.
def _delete_allowed(upload_root: Path, raw_path: str) -> bool:
    target = Path(raw_path).resolve()
    root = upload_root.resolve()
    return root in target.parents


# Mirrors upload_raw_handler path whitelist.
def _raw_allowed(upload_root: Path, raw_path: str) -> bool:
    target = Path(raw_path).resolve()
    try:
        target.relative_to(upload_root.resolve())
        return True
    except (ValueError, OSError):
        return False


# Mirrors upload_raw_handler original filename recovery.
def _original_upload_name(path: Path) -> str:
    return path.name.split("__", 1)[-1]


class TestSafeSessionDir:
    def test_keeps_safe_ascii_chars(self):
        assert _safe_session_dir("abc-DEF_123") == "abc-DEF_123"

    def test_strips_path_traversal_and_spaces(self):
        assert _safe_session_dir(" ../../team notes ") == "teamnotes"

    def test_empty_or_none_falls_back_to_misc(self):
        assert _safe_session_dir("") == "_misc"
        assert _safe_session_dir(None) == "_misc"

    def test_non_ascii_only_sid_falls_back_to_misc(self):
        assert _safe_session_dir("报告/会议") == "_misc"


class TestSessionUploadDir:
    def test_scopes_uploads_under_sanitized_sid(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        actual = _session_upload_dir(root, "../../tui_worker")
        assert actual == root / "tui_worker"

    def test_files_bucket_stays_isolated(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        actual = _session_upload_dir(root, "_files")
        assert actual == root / "_files"


class TestUploadPathConstruction:
    def test_replaces_slashes_in_uploaded_name(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        path = _build_upload_path(root, "session-1", "dir/sub\\name.txt", "abc123def456")
        assert path == root / "session-1" / "abc123def456__dir_sub_name.txt"

    def test_uses_file_when_name_empty(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        path = _build_upload_path(root, "session-1", "   ", "abc123def456")
        assert path.name == "abc123def456__file"


class TestUploadDecode:
    def test_server_limit_matches_composer_contract(self):
        assert bridge.MAX_UPLOAD_BYTES == 50 * 1024 * 1024

    def test_decodes_data_url_payload(self):
        payload = "hello,world".encode("utf-8")
        data_url = "data:text/plain;base64," + base64.b64encode(payload).decode("ascii")
        assert bridge._decode_upload_data(data_url, max_bytes=len(payload)) == payload

    def test_decodes_raw_base64_payload(self):
        payload = b"abc123"
        raw = base64.b64encode(payload).decode("ascii")
        assert bridge._decode_upload_data(raw, max_bytes=len(payload)) == payload

    def test_rejects_payload_above_exact_decoded_limit(self):
        encoded = base64.b64encode(b"abcd").decode("ascii")
        with pytest.raises(bridge._UploadTooLarge):
            bridge._decode_upload_data(encoded, max_bytes=3)

    def test_rejects_invalid_base64(self):
        with pytest.raises(ValueError):
            bridge._decode_upload_data("not base64!", max_bytes=1024)


def test_upload_handler_enforces_decoded_and_request_body_limits(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    upload_root = tmp_path / "desktop_uploads"
    monkeypatch.setattr(bridge, "_WEB_UPLOAD_DIR", upload_root)
    monkeypatch.setattr(bridge, "MAX_UPLOAD_BYTES", 3)
    monkeypatch.setattr(bridge, "_MAX_UPLOAD_REQUEST_BYTES", 1024)
    monkeypatch.setattr(bridge.manager, "mutation", lambda: contextlib.nullcontext())

    async def scenario():
        app = web.Application(client_max_size=2048)
        app.router.add_post("/upload", bridge.upload_handler)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            accepted = await client.post(
                "/upload",
                json={
                    "name": "three.bin",
                    "dataUrl": base64.b64encode(b"abc").decode("ascii"),
                    "sid": "size-test",
                },
            )
            assert accepted.status == 200
            accepted_data = await accepted.json()
            assert accepted_data["ok"] is True
            assert Path(accepted_data["path"]).read_bytes() == b"abc"

            oversized = await client.post(
                "/upload",
                json={
                    "name": "four.bin",
                    "dataUrl": base64.b64encode(b"abcd").decode("ascii"),
                    "sid": "size-test",
                },
            )
            assert oversized.status == 413
            assert await oversized.json() == {
                "ok": False,
                "code": "file_too_large",
                "error": "file exceeds 50 MB limit",
            }
            assert len(list(upload_root.rglob("*__four.bin"))) == 0

            monkeypatch.setattr(bridge, "_MAX_UPLOAD_REQUEST_BYTES", 8)
            body_limited = await client.post(
                "/upload",
                json={"name": "tiny.bin", "dataUrl": "YQ==", "sid": "size-test"},
            )
            assert body_limited.status == 413
            assert (await body_limited.json())["code"] == "file_too_large"
            assert len(list(upload_root.rglob("*__tiny.bin"))) == 0

            async def chunked_body():
                yield b'{"name":'
                yield b'"chunked.bin","dataUrl":"YQ=="}'

            chunked_limited = await client.post(
                "/upload",
                data=chunked_body(),
                headers={"Content-Type": "application/json"},
            )
            assert chunked_limited.status == 413
            assert (await chunked_limited.json())["code"] == "file_too_large"
            assert len(list(upload_root.rglob("*__chunked.bin"))) == 0
        finally:
            await client.close()

    asyncio.run(scenario())


class TestUploadPathSafety:
    def test_delete_allows_file_inside_upload_root(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        target = root / "session-1" / "abc__note.txt"
        target.parent.mkdir(parents=True)
        target.write_text("ok", encoding="utf-8")
        assert _delete_allowed(root, str(target)) is True

    def test_delete_rejects_file_outside_upload_root(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        outside = tmp_path / "outside.txt"
        outside.write_text("nope", encoding="utf-8")
        assert _delete_allowed(root, str(outside)) is False

    def test_raw_allows_file_inside_upload_root(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        target = root / "session-1" / "abc__report.csv"
        target.parent.mkdir(parents=True)
        target.write_text("x,y", encoding="utf-8")
        assert _raw_allowed(root, str(target)) is True

    def test_raw_rejects_path_traversal_outside_upload_root(self, tmp_path: Path):
        root = tmp_path / "desktop_uploads"
        outside = tmp_path / "secret.txt"
        outside.write_text("top secret", encoding="utf-8")
        assert _raw_allowed(root, str(outside)) is False


class TestOriginalUploadName:
    def test_strips_uuid_prefix_from_uploaded_file(self):
        path = Path("/tmp/desktop_uploads/session-1/abc123def456__my report.txt")
        assert _original_upload_name(path) == "my report.txt"

    def test_preserves_cjk_filename(self):
        path = Path("/tmp/desktop_uploads/session-1/abc123def456__报告.csv")
        assert _original_upload_name(path) == "报告.csv"

    def test_filename_without_prefix_returns_name_as_is(self):
        path = Path("/tmp/desktop_uploads/session-1/plain.txt")
        assert _original_upload_name(path) == "plain.txt"
