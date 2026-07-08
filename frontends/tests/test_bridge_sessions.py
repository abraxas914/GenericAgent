"""Tests for session persistence: race conditions, corruption resilience, and reload."""
from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

# Add project root to path so we can import bridge helpers.
BRIDGE_PATH = Path(__file__).resolve().parent.parent / "desktop_bridge.py"
PROJECT_ROOT = BRIDGE_PATH.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# We need a lightweight extraction of AgentManager without starting the full server.
# Import the module to get access to _load_plan_baseline, _sanitize_desktop_plan_path, Session, etc.
import importlib.util

_spec = importlib.util.spec_from_file_location("desktop_bridge", str(BRIDGE_PATH))
_mod = importlib.util.module_from_spec(_spec)
sys.modules["desktop_bridge"] = _mod

# Patch heavy imports that desktop_bridge may pull in.
import types as _types

def _make_stub(name, attrs=None):
    m = _types.ModuleType(name)
    if attrs:
        for k, v in attrs.items():
            setattr(m, k, v)
    return m

_plan_state_stub = _make_stub("plan_state", {
    "is_session_scoped_plan_path": lambda p, sid: True,
    "is_plan_preset_prompt": lambda prompt: False,
    "PLAN_PRESETS": {},
})

for _name in ("agentmain", "llmcore", "agent_loop", "plugins", "reflect",
              "frontends.plan_state", "cost_tracker"):
    sys.modules.setdefault(_name, _make_stub(_name))
sys.modules["plan_state"] = _plan_state_stub

# Attempt import; if it fails due to missing deps, skip.
try:
    _spec.loader.exec_module(_mod)
except Exception as exc:
    pytest.skip(f"Cannot import desktop_bridge: {exc}", allow_module_level=True)

Session = _mod.Session
AgentManager = _mod.AgentManager


@pytest.fixture
def tmp_ga_root(tmp_path: Path):
    """Create a minimal GA root with temp/desktop_sessions/ directory."""
    sessions_dir = tmp_path / "temp" / "desktop_sessions"
    sessions_dir.mkdir(parents=True)
    # Provide a dummy mykey_template so AgentManager.__init__ doesn't break.
    (tmp_path / "mykey_template.py").write_text("", encoding="utf-8")
    return tmp_path


@pytest.fixture
def manager(tmp_ga_root: Path):
    """Create an AgentManager using the tmp root."""
    with patch.object(AgentManager, "__init__", lambda self: None):
        mgr = AgentManager.__new__(AgentManager)
    mgr.lock = threading.RLock()
    mgr.ga_root = str(tmp_ga_root)
    mgr.config = {}
    mgr.sessions = {}
    mgr.active_session_id = None
    mgr._sessions_dir = tmp_ga_root / "temp" / "desktop_sessions"
    mgr._sessions_file = tmp_ga_root / "temp" / "desktop_sessions.json"
    return mgr


def _make_session(sid: str = "sess-test-1", messages: list | None = None) -> Session:
    return Session(
        id=sid,
        title="Test",
        cwd="/tmp",
        created_at=time.time(),
        updated_at=time.time(),
        messages=messages if messages is not None else [{"role": "user", "content": "hello"}],
        msg_seq=1,
        pinned=False,
        untitled=False,
        plan_scan_baseline=0,
        plan_path="",
        status="idle",
        agent=None,
        llm_history=[{"role": "user", "content": "hello"}],
        llm_no=None,
    )


class TestPersistSessionConcurrentMutation:
    """Verify that concurrent mutations to messages during _persist_session don't corrupt data."""

    def test_concurrent_append_no_crash(self, manager: AgentManager):
        """Appending messages from another thread during persist must not raise."""
        sess = _make_session(messages=[{"role": "user", "content": f"msg-{i}"} for i in range(50)])
        manager.sessions[sess.id] = sess

        errors = []
        stop = threading.Event()

        def mutator():
            i = 100
            while not stop.is_set():
                sess.messages.append({"role": "assistant", "content": f"resp-{i}"})
                i += 1
                time.sleep(0.001)

        t = threading.Thread(target=mutator, daemon=True)
        t.start()
        try:
            for _ in range(20):
                try:
                    manager._persist_session(sess)
                except Exception as e:
                    errors.append(e)
                time.sleep(0.005)
        finally:
            stop.set()
            t.join(timeout=2)

        assert not errors, f"persist raised: {errors}"
        # Verify the file is valid JSON.
        f = manager._session_file(sess.id)
        data = json.loads(f.read_text(encoding="utf-8"))
        assert data["id"] == sess.id
        assert isinstance(data["messages"], list)

    def test_concurrent_mutation_llm_history(self, manager: AgentManager):
        """Mutating llm_history from another thread during persist must not corrupt."""
        sess = _make_session()
        sess.llm_history = [{"role": "user", "content": "hi"}]
        manager.sessions[sess.id] = sess

        stop = threading.Event()

        def mutator():
            i = 0
            while not stop.is_set():
                sess.llm_history.append({"role": "assistant", "content": f"turn-{i}"})
                i += 1
                time.sleep(0.001)

        t = threading.Thread(target=mutator, daemon=True)
        t.start()
        try:
            for _ in range(15):
                manager._persist_session(sess)
                time.sleep(0.005)
        finally:
            stop.set()
            t.join(timeout=2)

        f = manager._session_file(sess.id)
        data = json.loads(f.read_text(encoding="utf-8"))
        assert isinstance(data["llm_history"], list)


class TestLoadSessionsCorruptFile:
    """Verify that one corrupt file does not prevent loading others."""

    def test_corrupt_file_skipped(self, manager: AgentManager):
        """A corrupt JSON file should be skipped; valid sessions still load."""
        sessions_dir = manager._sessions_dir
        # Write 2 valid sessions.
        for i in range(2):
            sid = f"sess-valid-{i}"
            data = {"id": sid, "title": f"Valid {i}", "messages": [], "msg_seq": 0,
                    "cwd": "/tmp", "created_at": time.time(), "updated_at": time.time()}
            (sessions_dir / f"{sid}.json").write_text(json.dumps(data), encoding="utf-8")
        # Write 1 corrupt file.
        (sessions_dir / "sess-corrupt.json").write_text("{invalid json !!!", encoding="utf-8")

        manager._load_sessions()

        assert len(manager.sessions) == 2
        assert "sess-valid-0" in manager.sessions
        assert "sess-valid-1" in manager.sessions
        assert "sess-corrupt" not in manager.sessions

    def test_empty_file_skipped(self, manager: AgentManager):
        """An empty file should be skipped without crash."""
        sessions_dir = manager._sessions_dir
        (sessions_dir / "sess-empty.json").write_text("", encoding="utf-8")
        (sessions_dir / "sess-ok.json").write_text(
            json.dumps({"id": "sess-ok", "title": "OK", "messages": [], "msg_seq": 0,
                        "cwd": "/tmp", "created_at": time.time(), "updated_at": time.time()}),
            encoding="utf-8")

        manager._load_sessions()
        assert "sess-ok" in manager.sessions
        assert len(manager.sessions) == 1


class TestLoadSessionsMissingDir:
    """Verify graceful handling when sessions directory does not exist."""

    def test_missing_dir_returns_empty(self, tmp_ga_root: Path):
        """If temp/desktop_sessions/ doesn't exist, load returns empty without crash."""
        import shutil
        sessions_dir = tmp_ga_root / "temp" / "desktop_sessions"
        shutil.rmtree(sessions_dir)

        with patch.object(AgentManager, "__init__", lambda self: None):
            mgr = AgentManager.__new__(AgentManager)
        mgr.lock = threading.RLock()
        mgr.ga_root = str(tmp_ga_root)
        mgr.config = {}
        mgr.sessions = {}
        mgr.active_session_id = None
        mgr._sessions_dir = sessions_dir
        mgr._sessions_file = tmp_ga_root / "temp" / "desktop_sessions.json"

        mgr._load_sessions()
        assert mgr.sessions == {}


class TestPersistAtomicNoDataLoss:
    """Verify that a failed write does not destroy the existing session file."""

    def test_write_failure_preserves_original(self, manager: AgentManager):
        """If write_text raises mid-write, the original .json file is untouched."""
        sess = _make_session(sid="sess-atomic-test", messages=[{"role": "user", "content": "original"}])
        manager.sessions[sess.id] = sess
        # Persist once successfully.
        manager._persist_session(sess)
        original_content = manager._session_file(sess.id).read_text(encoding="utf-8")

        # Now make the session have new content and make tmp write fail.
        sess.messages.append({"role": "assistant", "content": "new content"})
        with patch("pathlib.Path.write_text", side_effect=OSError("disk full")):
            manager._persist_session(sess)

        # Original file should be untouched (os.replace never ran because tmp write failed).
        current_content = manager._session_file(sess.id).read_text(encoding="utf-8")
        assert current_content == original_content

    def test_replace_failure_preserves_original(self, manager: AgentManager):
        """If os.replace raises, the original file is untouched."""
        sess = _make_session(sid="sess-replace-test", messages=[{"role": "user", "content": "original"}])
        manager.sessions[sess.id] = sess
        manager._persist_session(sess)
        original_content = manager._session_file(sess.id).read_text(encoding="utf-8")

        sess.messages.append({"role": "assistant", "content": "new"})
        with patch("os.replace", side_effect=OSError("permission denied")):
            manager._persist_session(sess)

        current_content = manager._session_file(sess.id).read_text(encoding="utf-8")
        assert current_content == original_content
