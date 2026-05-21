#!/usr/bin/env python3
"""
GenericAgent Web2 Bridge.

Clear split:
1) AgentManager: owns GenericAgent instances, sessions and histories.
2) Transport: HTTP is the command/data channel; WebSocket only pushes small
   session-state notifications.

HTTP API:
  GET    /status
  GET    /config
  POST   /config
  GET    /model-profiles  (+ POST / PUT / DELETE by id)
  GET    /sessions
  POST   /session/new
  GET    /session/{sid}
  DELETE /session/{sid}
  POST   /session/{sid}/prompt
  GET    /session/{sid}/messages?after=0&limit=200
  POST   /session/{sid}/cancel
  POST   /services/start        body: {"id":"frontends/qqapp.py"}
  POST   /services/stop         body: {"id":"frontends/qqapp.py"}
  GET    /services/logs?id=frontends/qqapp.py&tail=200
  GET    /services/panel
  GET    /services/mykey
  POST   /services/mykey       body: {"content":"..."}

WS API (state sync):
  GET /ws -> on connect sends services.snapshot; service.changed on updates
  {"type":"services.snapshot","services":[...]}
  {"type":"service.changed","service":{...}}
"""
from __future__ import annotations

import asyncio, contextlib, importlib, json, os, re, subprocess, sys
from collections import deque
import threading, time, traceback, uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from aiohttp import web, WSMsgType

APP_DIR = Path(__file__).resolve().parent


def find_default_ga_root() -> Path:
    candidates = [
        APP_DIR / "..",
        APP_DIR / ".." / "..",
        APP_DIR / ".." / "GenericAgent",
        APP_DIR / ".." / ".." / "GenericAgent",
    ]
    for p in candidates:
        root = p.resolve()
        if (root / "agentmain.py").exists():
            return root
    return APP_DIR.parent.parent.resolve()


DEFAULT_GA_ROOT = find_default_ga_root()

for _s in (sys.stdout, sys.stderr):
    with contextlib.suppress(Exception):
        _s.reconfigure(encoding="utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Agent management layer
# ---------------------------------------------------------------------------

@dataclass
class Session:
    id: str
    title: str = "New chat"
    cwd: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    messages: List[dict] = field(default_factory=list)
    msg_seq: int = 0
    partial: Optional[dict] = None
    status: str = "idle"  # idle|running|error|cancelled
    agent: Any = None
    thread: Optional[threading.Thread] = None
    cancel_requested: bool = False
    last_error: str = ""


class AgentManager:
    def __init__(self):
        self.lock = threading.RLock()
        self.ga_root = str(DEFAULT_GA_ROOT)
        self.config: Dict[str, Any] = {}
        self.sessions: Dict[str, Session] = {}
        self.active_session_id: Optional[str] = None
        self._sessions_file = Path(self.ga_root) / "temp" / "desktop_sessions.json"
        self._load_sessions()

    @property
    def mykey_path(self) -> str:
        return str(Path(self.ga_root) / "mykey.py")

    def _persist(self):
        try:
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            arr = []
            with self.lock:
                for s in self.sessions.values():
                    arr.append({"id": s.id, "title": s.title, "cwd": s.cwd,
                                "created_at": s.created_at, "updated_at": s.updated_at,
                                "messages": s.messages, "msg_seq": s.msg_seq})
            self._sessions_file.write_text(json.dumps(arr, ensure_ascii=False, default=str), encoding="utf-8")
        except Exception as e:
            print(f"[bridge] persist sessions failed: {e}", file=sys.stderr)

    def _load_sessions(self):
        try:
            if not self._sessions_file.exists():
                return
            arr = json.loads(self._sessions_file.read_text(encoding="utf-8"))
            for item in arr:
                sess = Session(id=item["id"], title=item.get("title", "New chat"),
                               cwd=item.get("cwd", self.ga_root),
                               created_at=item.get("created_at", time.time()),
                               updated_at=item.get("updated_at", time.time()),
                               messages=item.get("messages", []),
                               msg_seq=item.get("msg_seq", 0),
                               status="idle", agent=None)
                self.sessions[sess.id] = sess
            if self.sessions:
                self.active_session_id = max(self.sessions.values(), key=lambda s: s.updated_at).id
        except Exception as e:
            print(f"[bridge] load sessions failed: {e}", file=sys.stderr)

    def _mykey_file(self) -> Path:
        p = Path(self.ga_root) / "mykey.py"
        if not p.exists():
            tpl = Path(self.ga_root) / "mykey_template.py"
            p.write_text(tpl.read_text(encoding="utf-8") if tpl.exists() else "", encoding="utf-8")
        return p

    @staticmethod
    def _next_native_var(text: str, protocol: str) -> str:
        # 协议必选(由前端下拉强制),不再用 apibase 兜底瞎猜
        proto = str(protocol or "").strip().lower()
        if proto == "claude":
            prefix = "native_claude_config"
        elif proto in ("oai", "openai"):
            prefix = "native_oai_config"
        else:
            raise ValueError("protocol is required: choose 'oai' or 'claude'")
        nums = [0]
        if re.search(rf"^{prefix}\s*=", text, re.M):
            nums.append(0)
        nums.extend(int(m.group(1)) for m in re.finditer(rf"^{prefix}(\d+)\s*=", text, re.M))
        n = max(nums) + 1
        return prefix if n == 1 and not re.search(rf"^{prefix}\s*=", text, re.M) else f"{prefix}{n}"

    @staticmethod
    def _format_py_dict(d: dict) -> str:
        lines = [f"    '{k}': {json.dumps(v, ensure_ascii=False)}," if isinstance(v, str) else f"    '{k}': {v}," for k, v in d.items()]
        return "{\n" + "\n".join(lines) + "\n}"

    def _invalidate_mykey_cache(self) -> None:
        self.ensure_ga_import_path()
        sys.modules.pop("mykey", None)
        with contextlib.suppress(Exception):
            import llmcore
            llmcore._mykey_mtime = None

    def _profile_keys(self) -> List[str]:
        self.ensure_ga_import_path()
        from llmcore import reload_mykeys
        return [k for k in reload_mykeys()[0] if any(x in k for x in ("api", "config", "cookie"))]

    def _profile_at(self, profile_id: int) -> tuple[str, dict]:
        keys = self._profile_keys()
        if profile_id < 0 or profile_id >= len(keys):
            raise ValueError("profile not found")
        var = keys[profile_id]
        if "mixin" in var:
            raise ValueError("mixin profiles not supported here")
        from llmcore import reload_mykeys
        cfg = reload_mykeys()[0].get(var)
        if not isinstance(cfg, dict):
            raise ValueError("profile not editable")
        return var, dict(cfg)

    @staticmethod
    def _find_var_block_span(text: str, var_name: str) -> Optional[tuple[int, int]]:
        m = re.search(rf"^{re.escape(var_name)}\s*=\s*\{{", text, re.M)
        if not m:
            return None
        start, i, depth = m.start(), m.end() - 1, 0
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    while end < len(text) and text[end] in "\r\n":
                        end += 1
                    return start, end
            i += 1
        return None

    def _patch_var_block(self, text: str, var: str, cfg: Optional[dict] = None) -> str:
        if not (span := self._find_var_block_span(text, var)):
            raise ValueError(f"config block not found: {var}")
        s, e = span
        if cfg is None:
            return text[:s].rstrip() + "\n" + text[e:].lstrip("\n")
        return text[:s] + f"{var} = {self._format_py_dict(cfg)}\n" + text[e:]

    def _build_cfg(self, data: dict, existing: Optional[dict] = None, *, require_key: bool = True) -> dict:
        apibase, model = str(data.get("apibase") or "").strip(), str(data.get("model") or "").strip()
        if not apibase or not model:
            raise ValueError("apibase and model are required")
        apikey = str(data.get("apikey") or "").strip() or str((existing or {}).get("apikey") or "").strip()
        if require_key and not apikey:
            raise ValueError("apikey is required")
        cfg: Dict[str, Any] = {"apikey": apikey, "apibase": apibase, "model": model}
        if name := str(data.get("name") or "").strip():
            cfg["name"] = name
        for k in ("max_retries", "connect_timeout", "read_timeout"):
            if data.get(k) is not None and str(data.get(k)).strip() != "":
                cfg[k] = int(data[k])
            elif existing and k in existing:
                cfg[k] = existing[k]
        return cfg

    def _save_mykey_text(self, text: str) -> list:
        self._mykey_file().write_text(text, encoding="utf-8")
        self._invalidate_mykey_cache()
        return self.list_model_profiles()

    def add_model_profile(self, data: dict) -> dict:
        cfg = self._build_cfg(data)
        text = self._mykey_file().read_text(encoding="utf-8")
        var = self._next_native_var(text, data.get("protocol", ""))
        profiles = self._save_mykey_text(text.rstrip() + f"\n{var} = {self._format_py_dict(cfg)}\n")
        return {"varName": var, "profileId": profiles[-1]["id"] if profiles else 0, "profiles": profiles}

    def get_model_profile(self, profile_id: int) -> dict:
        var, cfg = self._profile_at(profile_id)
        ks = ("model", "apibase", "apikey", "name", "max_retries", "connect_timeout", "read_timeout")
        return {"id": profile_id, "varName": var, **{k: cfg.get(k, d) for k, d in zip(ks, ("", "", "", "", 5, 15, 300))}}

    def update_model_profile(self, profile_id: int, data: dict) -> dict:
        var, existing = self._profile_at(profile_id)
        text = self._mykey_file().read_text(encoding="utf-8")
        profiles = self._save_mykey_text(self._patch_var_block(text, var, self._build_cfg(data, existing, require_key=False)))
        return {"varName": var, "profileId": profile_id, "profiles": profiles}

    def delete_model_profile(self, profile_id: int) -> dict:
        if len(self._profile_keys()) <= 1:
            raise ValueError("cannot delete the last profile")
        var, _ = self._profile_at(profile_id)
        profiles = self._save_mykey_text(self._patch_var_block(self._mykey_file().read_text(encoding="utf-8"), var).rstrip() + "\n")
        return {"profileId": profile_id, "profiles": profiles}

    def ensure_ga_import_path(self) -> Path:
        root = Path(self.ga_root).resolve()
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        return root

    def make_agent(self, sess: Session):
        root = self.ensure_ga_import_path()
        try: import cost_tracker; cost_tracker.install()
        except Exception: pass
        old_cwd = os.getcwd()
        try:
            os.chdir(sess.cwd or str(root))
            agentmain = importlib.import_module("agentmain")
            GA = getattr(agentmain, "GenericAgent")
            agent = GA()
            agent.inc_out = True
            agent.verbose = True
            threading.Thread(target=agent.run, daemon=True, name=f"GA-{sess.id}").start()
            return agent
        finally:
            with contextlib.suppress(Exception):
                os.chdir(old_cwd)

    def list_model_profiles(self):
        self.ensure_ga_import_path()
        try:
            agentmain = importlib.import_module("agentmain")
            agent = agentmain.GenericAgent()
            if hasattr(agent, "list_llms"):
                return [{"id": i, "name": name, "active": active} for i, name, active in agent.list_llms()]
        except Exception as e:
            print(f"get model profiles failed: {e}", file=sys.stderr)
        return []

    def snapshot(self, sess: Session, include_messages: bool = True) -> dict:
        out = {
            "sessionId": sess.id,
            "id": sess.id,
            "title": sess.title,
            "cwd": sess.cwd,
            "status": sess.status,
            "createdAt": sess.created_at,
            "updatedAt": sess.updated_at,
            "lastError": sess.last_error,
            "msgSeq": sess.msg_seq,
        }
        if include_messages:
            out["messages"] = list(sess.messages)
            out["partial"] = dict(sess.partial) if sess.partial else None
        return out

    def add_message(self, sess: Session, role: str, content: str, **extra) -> dict:
        sess.msg_seq += 1
        msg = {"id": sess.msg_seq, "role": role, "content": content, "ts": time.time()}
        msg.update(extra)
        sess.messages.append(msg)
        sess.updated_at = time.time()
        if role == "user" and content.strip() and sess.title == "New chat":
            sess.title = content.strip().replace("\n", " ")[:40]
        self._persist()
        return msg

    def create_session(self, cwd: Optional[str] = None) -> Session:
        sid = "sess-" + uuid.uuid4().hex[:12]
        sess = Session(id=sid, cwd=str(cwd or self.ga_root))
        with self.lock:
            self.sessions[sid] = sess
            self.active_session_id = sid
        emit_session_state(sess, "created")
        self._persist()
        return sess

    def get_session(self, sid: str) -> Session:
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            return sess

    def delete_session(self, sid: str) -> dict:
        with self.lock:
            sess = self.sessions.pop(sid, None)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            if self.active_session_id == sid:
                self.active_session_id = next(iter(self.sessions), None)
            if sess.agent and hasattr(sess.agent, "abort"):
                with contextlib.suppress(Exception):
                    sess.agent.abort()
        emit_session_state(sess, "closed")
        self._persist()
        return {"ok": True, "sessionId": sid}

    def submit_prompt(self, sid: str, prompt: Any, images: Optional[list] = None, llm_no: Optional[int] = None) -> dict:
        prompt, image_ids = normalize_prompt(prompt, images)
        if llm_no is not None:
            self.config["llmNo"] = int(llm_no)
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            if sess.status == "running":
                raise web.HTTPConflict(text=json.dumps({"error": "session is already running"}, ensure_ascii=False), content_type="application/json")
            extra = {}
            if image_ids:
                extra["image_ids"] = image_ids
            user_msg = self.add_message(sess, "user", prompt, **extra)
            sess.status = "running"
            sess.cancel_requested = False
            sess.last_error = ""
            sess.partial = {"id": sess.msg_seq + 1, "role": "assistant", "content": "", "ts": time.time(), "partial": True}
            t = threading.Thread(target=self.run_agent_turn, args=(sess, prompt, None, llm_no), daemon=True, name=f"Turn-{sid}")
            sess.thread = t
            t.start()
            seq = sess.msg_seq
        emit_session_state(sess, "running")
        return {"ok": True, "sessionId": sid, "accepted": True, "userMessageId": user_msg["id"], "seq": seq}

    def run_agent_turn(self, sess: Session, prompt: str, images: Optional[list] = None, llm_no: Optional[int] = None):
        try:
            if sess.agent is None:
                sess.agent = self.make_agent(sess)
            agent = sess.agent
            no = self.config.get("llmNo") if llm_no is None else llm_no
            if no is not None and hasattr(agent, "next_llm"):
                with contextlib.suppress(Exception):
                    agent.next_llm(int(no))
            full = ""
            if hasattr(agent, "put_task"):
                display_q = agent.put_task(prompt, images=images or [])
                pieces = []
                import queue as _queue
                while True:
                    if sess.cancel_requested:
                        break
                    try:
                        item = display_q.get(timeout=1.0)
                    except _queue.Empty:
                        continue
                    if isinstance(item, dict):
                        if item.get("next"):
                            text = str(item["next"])
                            pieces.append(text)
                            with self.lock:
                                if sess.partial is not None:
                                    sess.partial["content"] = "".join(pieces) if getattr(agent, "inc_out", False) else text
                                    sess.partial["ts"] = time.time()
                                    sess.updated_at = time.time()
                        if "done" in item:
                            full = str(item.get("done") or "")
                            break
                    else:
                        pieces.append(str(item))
                if not full and pieces:
                    full = pieces[-1] if not getattr(agent, "inc_out", False) else "".join(pieces)
            elif hasattr(agent, "run"):
                ret = agent.run(prompt)
                if isinstance(ret, str):
                    full = ret
            else:
                full = "GenericAgent object has no put_task/run method"
            if not full:
                full = "(completed)"
            if sess.cancel_requested:
                with self.lock:
                    sess.partial = None
                    # Ensure status stays cancelled (don't overwrite)
                    if sess.status != "cancelled":
                        sess.status = "cancelled"
                    sess.updated_at = time.time()
                emit_session_state(sess, "cancelled")
                return
            with self.lock:
                sess.partial = None
                # Strip trailing [Info] Final response to user. marker
                import re as _re
                full = _re.sub(r'\n*`{5}\n*\[Info\] Final response to user\.\n*`{5}\s*$', '', full)
                self.add_message(sess, "assistant", full)
                sess.status = "idle"
                sess.last_error = ""
            emit_session_state(sess, "idle")
        except Exception as e:
            tb = traceback.format_exc()
            with self.lock:
                sess.partial = None
                sess.status = "error"
                sess.last_error = str(e)
                self.add_message(sess, "error", str(e))
            print(tb, file=sys.stderr)
            emit_session_state(sess, "error")

    def messages(self, sid: str, after: int = 0, limit: int = 200) -> dict:
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            msgs = [m for m in sess.messages if int(m.get("id", 0)) > after]
            if limit > 0:
                msgs = msgs[-limit:]
            return {
                "sessionId": sid,
                "status": sess.status,
                "messages": msgs,
                "partial": dict(sess.partial) if sess.partial else None,
                "msgSeq": sess.msg_seq,
                "updatedAt": sess.updated_at,
                "lastError": sess.last_error,
            }

    def cancel(self, sid: str) -> dict:
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            sess.cancel_requested = True
            if sess.agent and hasattr(sess.agent, "abort"):
                with contextlib.suppress(Exception):
                    sess.agent.abort()
            sess.status = "cancelled"
            sess.partial = None
            sess.updated_at = time.time()
        emit_session_state(sess, "cancelled")
        return {"ok": True, "sessionId": sid}

    def restore_context(self, sid: str) -> dict:
        with self.lock:
            sess = self.sessions.get(sid)
            if not sess:
                raise web.HTTPNotFound(text=json.dumps({"error": f"session not found: {sid}"}, ensure_ascii=False), content_type="application/json")
            if sess.agent is not None:
                return {"ok": True, "sessionId": sid, "restored": False, "reason": "agent already alive"}
        agent = self.make_agent(sess)
        history = []
        for m in sess.messages:
            role = m.get("role")
            content = m.get("content", "")
            if role == "user":
                history.append({"role": "user", "content": [{"type": "text", "text": content}]})
            elif role == "assistant":
                history.append({"role": "assistant", "content": [{"type": "text", "text": content}]})
        if history:
            try:
                agent.llmclient.backend.history = history
            except Exception as e:
                print(f"[bridge] inject history failed: {e}", file=sys.stderr)
        with self.lock:
            sess.agent = agent
            sess.status = "idle"
        return {"ok": True, "sessionId": sid, "restored": True, "messageCount": len(history)}


import base64
import tempfile

# Shared temp dir for image uploads (persists for process lifetime)
_UPLOAD_DIR = Path(tempfile.gettempdir()) / "ga_web2_uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _save_image_data(data_url: str, img_id: str) -> str:
    """Save a data URL to disk, return absolute path."""
    # data:image/png;base64,xxxxx
    if "," in data_url:
        header, b64 = data_url.split(",", 1)
    else:
        b64 = data_url
        header = ""
    ext = "png"
    if "jpeg" in header or "jpg" in header:
        ext = "jpg"
    elif "webp" in header:
        ext = "webp"
    elif "gif" in header:
        ext = "gif"
    fpath = _UPLOAD_DIR / f"{img_id}.{ext}"
    fpath.write_bytes(base64.b64decode(b64))
    return str(fpath)


def normalize_prompt(prompt: Any, images: Optional[list] = None):
    """Normalize prompt and images.
    
    images: list of dicts {"id": "img-xxx", "dataUrl": "data:..."} or plain data URLs.
    Returns: (prompt_text_with_image_tags, image_ids_list)
    """
    images = list(images or [])
    if isinstance(prompt, list):
        text_parts = []
        for part in prompt:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict):
                if part.get("type") in ("text", "input_text"):
                    text_parts.append(str(part.get("text") or part.get("content") or ""))
                elif part.get("type") in ("image", "input_image"):
                    url = part.get("image_url") or part.get("url") or part.get("data")
                    if isinstance(url, dict):
                        url = url.get("url")
                    if url:
                        images.append(url)
        prompt = "\n".join([p for p in text_parts if p])

    # Process images: save to disk, build [image:path] tags
    image_ids = []
    image_tags = []
    for img in images:
        if isinstance(img, dict):
            img_id = img.get("id") or f"img-{uuid.uuid4().hex[:8]}"
            data_url = img.get("dataUrl") or img.get("data_url") or ""
        else:
            # Plain data URL string
            img_id = f"img-{uuid.uuid4().hex[:8]}"
            data_url = str(img)
        if data_url:
            path = _save_image_data(data_url, img_id)
            image_tags.append(f"[image:{path}]")
            image_ids.append(img_id)

    # Append image tags to prompt
    final_prompt = str(prompt or "")
    if image_tags:
        final_prompt = final_prompt + "\n" + "\n".join(image_tags)

    return final_prompt, image_ids


manager = AgentManager()


# ---------------------------------------------------------------------------
# Transport layer: WS state push
# ---------------------------------------------------------------------------

class WsHub:
    def __init__(self):
        self.websockets: Set[web.WebSocketResponse] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def emit(self, obj: dict):
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self._broadcast(obj), self.loop)

    async def _broadcast(self, obj: dict):
        data = json.dumps(obj, ensure_ascii=False, default=str)
        dead = set()
        for ws in list(self.websockets):
            try:
                await ws.send_str(data)
            except Exception:
                dead.add(ws)
        self.websockets.difference_update(dead)


hub = WsHub()


# ---------------------------------------------------------------------------
# Service management (hub.pyw core + WS notify)
# ---------------------------------------------------------------------------

_SKIP = frozenset({"goal_mode.py", "chatapp_common.py", "tuiapp.py", "qtapp.py"})
BRIDGE_ID = "__bridge__"

_SERVICE_KEYS: Dict[str, tuple] = {
    "frontends/qqapp.py": ("qq_app_id", "qq_app_secret"),
    "frontends/dcapp.py": ("discord_bot_token",),
    "frontends/dingtalkapp.py": ("dingtalk_client_id", "dingtalk_client_secret"),
    "frontends/fsapp.py": ("fs_app_id", "fs_app_secret"),
    "frontends/tgapp.py": ("tg_bot_token",),
    "frontends/wecomapp.py": ("wecom_bot_id", "wecom_secret"),
}


def _load_mykeys(ga_root: Path) -> dict:
    if not (ga_root / "mykey.py").exists():
        return {}
    root = str(ga_root.resolve())
    if root not in sys.path:
        sys.path.insert(0, root)
    import mykey as mk
    importlib.reload(mk)
    return {k: v for k, v in vars(mk).items() if not k.startswith("_")}


def discover_im_services(ga_root: Path) -> List[dict]:
    out: List[dict] = []
    d = ga_root / "frontends"
    if not d.is_dir():
        return out
    for f in sorted(os.listdir(d)):
        if "app" not in f or not f.endswith(".py") or f in _SKIP or "stapp" in f or "tuiapp" in f:
            continue
        rel = f"frontends/{f}"
        out.append({"id": rel, "cmd": [sys.executable, str(d / f)]})
    return out


def discover_extra_services(ga_root: Path) -> List[dict]:
    out: List[dict] = []
    sched = ga_root / "reflect" / "scheduler.py"
    if sched.is_file():
        out.append({
            "id": "reflect/scheduler.py",
            "cmd": [sys.executable, "agentmain.py", "--reflect", "reflect/scheduler.py"],
        })
    return out


def _mem_mb(pid: Optional[int]) -> Optional[int]:
    if not pid:
        return None
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]
        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not h:
            return None
        ok = ctypes.windll.psapi.GetProcessMemoryInfo(h, ctypes.byref(counters), counters.cb)
        ctypes.windll.kernel32.CloseHandle(h)
        return round(counters.WorkingSetSize / 1024 / 1024) if ok else None
    status = Path(f"/proc/{pid}/status")
    if status.is_file():
        for line in status.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("VmRSS:"):
                return round(int(line.split()[1]) / 1024)
    return None


def _cpu_pct(pid: Optional[int]) -> Optional[float]:
    if not pid:
        return None
    try:
        import psutil
        return round(psutil.Process(pid).cpu_percent(0) or 0, 1)
    except Exception:
        return None


class ServiceManager:
    """hub.pyw ServiceManager + HTTP/WS glue."""

    def __init__(self, ga_root: str, emit_fn):
        self.ga_root = Path(ga_root)
        self.procs: Dict[str, subprocess.Popen] = {}
        self.buffers: Dict[str, deque] = {}
        self._emit = emit_fn
        im = discover_im_services(self.ga_root)
        extra = discover_extra_services(self.ga_root)
        self._im_catalog = {s["id"]: s for s in im}
        self._catalog = {**self._im_catalog, **{s["id"]: s for s in extra}}
        self._stopping: Set[str] = set()

    def _is_configured(self, sid: str) -> bool:
        keys = _SERVICE_KEYS.get(sid)
        if not keys:
            return True
        mykeys = _load_mykeys(self.ga_root)
        return all(str(mykeys.get(k) or "").strip() for k in keys)

    def _log_tail(self, sid: str, n: int = 3) -> str:
        buf = self.buffers.get(sid)
        if not buf:
            return ""
        lines = [ln.strip() for ln in list(buf)[-n:] if ln.strip()]
        return lines[-1][:300] if lines else ""

    def _state(self, sid: str, *, err: str = "") -> dict:
        proc = self.procs.get(sid)
        running = proc is not None and proc.poll() is None
        status = "running" if running else "offline"
        last_error = err
        if proc is not None and proc.poll() is not None:
            if sid in self._stopping:
                status, last_error = "offline", ""
            else:
                status = "error"
                last_error = err or self._log_tail(sid) or f"exit code {proc.returncode}"
        elif err:
            status, running = "error", False
        return {
            "id": sid,
            "status": status,
            "running": running,
            "pid": proc.pid if running else None,
            "lastError": last_error,
        }

    def list_state(self) -> List[dict]:
        return [self._state(sid) for sid in sorted(self._im_catalog)]

    def _bridge_state(self) -> dict:
        pid = os.getpid()
        port = int(os.environ.get("BRIDGE_PORT", "14168"))
        return {
            "id": BRIDGE_ID,
            "name": f"bridge (:{port})",
            "status": "running",
            "running": True,
            "pid": pid,
            "memMb": _mem_mb(pid),
            "cpuPct": _cpu_pct(pid),
            "managed": False,
            "lastError": "",
        }

    def list_panel_state(self) -> List[dict]:
        out = [self._bridge_state()]
        for sid in sorted(self._catalog):
            item = self._state(sid)
            item["name"] = sid
            item["memMb"] = _mem_mb(item.get("pid"))
            item["cpuPct"] = _cpu_pct(item.get("pid"))
            item["managed"] = True
            out.append(item)
        return out

    def _notify(self, sid: str, *, err: str = "") -> None:
        self._emit({"type": "service.changed", "service": self._state(sid, err=err)})

    def _wait_started(self, proc: subprocess.Popen, timeout: float = 2.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if proc.poll() is not None:
                return
            time.sleep(0.1)

    def _reader(self, sid: str, proc: subprocess.Popen) -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            buf = self.buffers.get(sid)
            if buf is not None:
                buf.append(line)
        self._notify(sid)

    def start_service(self, sid: str) -> dict:
        svc = self._catalog.get(sid)
        if not svc:
            raise KeyError(sid)
        proc = self.procs.get(sid)
        if proc is not None and proc.poll() is None:
            return {"ok": True, "service": self._state(sid)}
        if not self._is_configured(sid):
            keys = ", ".join(_SERVICE_KEYS.get(sid, ()))
            err = f"not configured in mykey.py ({keys})"
            self._notify(sid, err=err)
            return {"ok": False, "error": "not_configured", "service": self._state(sid, err=err)}
        self.buffers[sid] = deque(maxlen=500)
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        kw: Dict[str, Any] = dict(
            cwd=str(self.ga_root), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, env=env,
        )
        if sys.platform == "win32":
            kw["creationflags"] = subprocess.CREATE_NO_WINDOW
        proc = subprocess.Popen(svc["cmd"], **kw)
        self.procs[sid] = proc
        threading.Thread(target=self._reader, args=(sid, proc), daemon=True).start()
        self._wait_started(proc)
        item = self._state(sid)
        self._notify(sid)
        if item["status"] == "error":
            return {"ok": False, "error": item["lastError"] or "start_failed", "service": item}
        return {"ok": True, "service": item}

    def stop_service(self, sid: str) -> dict:
        if sid not in self._catalog:
            raise KeyError(sid)
        self._stopping.add(sid)
        proc = self.procs.get(sid)
        if proc and proc.poll() is None:
            proc.terminate()
            proc.wait()
        self.procs.pop(sid, None)
        self._stopping.discard(sid)
        item = self._state(sid)
        self._notify(sid)
        return {"ok": True, "service": item}

    def read_logs(self, sid: str, tail: int = 200) -> dict:
        if sid == BRIDGE_ID:
            return {"ok": True, "lines": [f"GenericAgent bridge pid={os.getpid()}"]}
        if sid not in self._catalog:
            raise KeyError(sid)
        tail = max(1, min(int(tail or 200), 2000))
        buf = self.buffers.get(sid)
        lines = [ln.rstrip("\n") for ln in list(buf or [])[-tail:]]
        return {"ok": True, "lines": lines}


services = ServiceManager(str(DEFAULT_GA_ROOT), hub.emit)


def emit_session_state(sess: Session, state_name: str):
    hub.emit({
        "type": "session-state",
        "sessionId": sess.id,
        "state": state_name,
        "status": sess.status,
        "seq": sess.msg_seq,
        "updatedAt": sess.updated_at,
        "title": sess.title,
    })


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    hub.websockets.add(ws)
    await ws.send_str(json.dumps({
        "type": "bridge-ready",
        "gaRoot": manager.ga_root,
        "mykeyPath": manager.mykey_path,
        "http": True,
        "wsEventsOnly": True,
    }, ensure_ascii=False))
    await ws.send_str(json.dumps({
        "type": "services.snapshot",
        "services": services.list_state(),
    }, ensure_ascii=False, default=str))
    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            # WS is intentionally not a data/command channel anymore.
            with contextlib.suppress(Exception):
                data = json.loads(msg.data)
                if data.get("action") == "ping":
                    await ws.send_str(json.dumps({"type": "pong", "ts": time.time()}, ensure_ascii=False))
    hub.websockets.discard(ws)
    return ws


# ---------------------------------------------------------------------------
# Transport layer: HTTP command/data API
# ---------------------------------------------------------------------------

def cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=cors_headers())
    resp = await handler(request)
    for k, v in cors_headers().items():
        resp.headers[k] = v
    return resp


def json_ok(data: dict, status: int = 200):
    return web.json_response(data, status=status, headers=cors_headers(), dumps=lambda x: json.dumps(x, ensure_ascii=False, default=str))


async def read_json(request) -> dict:
    if request.can_read_body:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    return {}


async def status_handler(request):
    return json_ok({
        "ok": True,
        "running": True,
        "ready": True,
        "gaRoot": manager.ga_root,
        "mykeyPath": manager.mykey_path,
        "sessionCount": len(manager.sessions),
        "activeSessionId": manager.active_session_id,
        "ws": "/ws",
        "transport": {"http": True, "wsEventsOnly": True},
    })


async def get_config_handler(request):
    profiles = manager.list_model_profiles()
    active = next((p["id"] for p in profiles if p.get("active")), manager.config.get("llmNo", 0))
    cfg = dict(manager.config)
    if "llmNo" not in cfg:
        cfg["llmNo"] = active
    return json_ok({"gaRoot": manager.ga_root, "mykeyPath": manager.mykey_path, "config": cfg})


async def save_config_handler(request):
    data = await read_json(request)
    cfg = data.get("config", data)
    if isinstance(cfg, dict):
        manager.config.update(cfg)
    return json_ok({"ok": True, "gaRoot": manager.ga_root, "mykeyPath": manager.mykey_path, "config": manager.config})


async def model_profiles_handler(request):
    try:
        pid = request.match_info.get("id")
        if pid is not None:
            profile_id = int(pid)
            if request.method == "GET":
                return json_ok({"profile": manager.get_model_profile(profile_id)})
            if request.method == "PUT":
                return json_ok({"ok": True, **manager.update_model_profile(profile_id, await read_json(request))})
            if request.method == "DELETE":
                return json_ok({"ok": True, **manager.delete_model_profile(profile_id)})
            return json_ok({"ok": False, "error": "method not allowed"}, status=405)
        if request.method == "POST":
            return json_ok({"ok": True, **manager.add_model_profile(await read_json(request))})
        return json_ok({"profiles": manager.list_model_profiles()})
    except ValueError as e:
        return json_ok({"ok": False, "error": str(e)}, status=400)
    except Exception as e:
        return json_ok({"ok": False, "error": str(e)}, status=500)


async def list_sessions_handler(request):
    with manager.lock:
        sessions = [manager.snapshot(s, include_messages=False) for s in manager.sessions.values()]
    return json_ok({"sessions": sessions, "activeSessionId": manager.active_session_id})


async def new_session_handler(request):
    data = await read_json(request)
    sess = manager.create_session(cwd=data.get("cwd") or data.get("path"))
    return json_ok({"ok": True, "sessionId": sess.id, "session": manager.snapshot(sess)}, status=201)


async def get_session_handler(request):
    sid = request.match_info["sid"]
    sess = manager.get_session(sid)
    return json_ok({"sessionId": sid, "session": manager.snapshot(sess), "messages": list(sess.messages), "partial": sess.partial})


async def delete_session_handler(request):
    sid = request.match_info["sid"]
    return json_ok(manager.delete_session(sid))


async def prompt_handler(request):
    sid = request.match_info["sid"]
    data = await read_json(request)
    prompt = data.get("prompt", data.get("content", data.get("message", "")))
    images = data.get("images") or []
    llm_no = data.get("llmNo")
    if llm_no is not None:
        llm_no = int(llm_no)
    return json_ok(manager.submit_prompt(sid, prompt, images, llm_no=llm_no))


async def messages_handler(request):
    sid = request.match_info["sid"]
    after = int(request.query.get("after") or request.query.get("afterId") or 0)
    limit = int(request.query.get("limit") or 200)
    return json_ok(manager.messages(sid, after=after, limit=limit))


async def cancel_handler(request):
    sid = request.match_info["sid"]
    return json_ok(manager.cancel(sid))


async def restore_handler(request):
    sid = request.match_info["sid"]
    return json_ok(manager.restore_context(sid))


async def path_open_handler(request):
    data = await read_json(request)
    kind = data.get("kind", "")
    if kind == "mykey":
        target = Path(manager.ga_root) / "mykey.py"
        if not target.exists():
            template = Path(manager.ga_root) / "mykey_template.py"
            target = template if template.exists() else target
    elif kind == "mykeyTemplate":
        target = Path(manager.ga_root) / "mykey_template.py"
    else:
        target = Path(data.get("path") or data.get("target") or manager.ga_root)
    target = target.resolve()
    if not target.exists():
        return json_ok({"ok": False, "error": f"File not found: {target}"}, status=404)
    try:
        _open_path_in_editor(target)
    except OSError as e:
        return json_ok({"ok": False, "error": str(e), "path": str(target)}, status=500)
    return json_ok({"ok": True, "path": str(target)})


def _open_path_in_editor(target: Path) -> None:
    """Open a file in the user's editor; Windows .py often has no default association."""
    import platform
    path = str(target.resolve())
    if platform.system() == "Windows":
        try:
            os.startfile(path, "edit")
            return
        except OSError:
            pass
        for cmd in (["notepad.exe", path], ["cursor.cmd", path], ["code.cmd", path], ["cursor", path], ["code", path]):
            try:
                subprocess.Popen(cmd, close_fds=True)
                return
            except (FileNotFoundError, OSError):
                continue
        raise OSError(f"No editor available to open: {path}")
    if platform.system() == "Darwin":
        subprocess.Popen(["open", path])
        return
    subprocess.Popen(["xdg-open", path])


def _mykey_file() -> Path:
    root = Path(manager.ga_root)
    target = root / "mykey.py"
    if not target.is_file():
        template = root / "mykey_template.py"
        if template.is_file():
            target.write_text(template.read_text(encoding="utf-8"), encoding="utf-8")
    return target


async def mykey_get_handler(request):
    target = _mykey_file()
    content = target.read_text(encoding="utf-8") if target.is_file() else ""
    return json_ok({"content": content, "path": str(target)})


async def mykey_save_handler(request):
    data = await read_json(request)
    content = data.get("content")
    if content is None:
        return json_ok({"ok": False, "error": "missing_content"}, status=400)
    target = _mykey_file()
    target.write_text(str(content), encoding="utf-8")
    return json_ok({"ok": True, "path": str(target)})


async def service_start_handler(request):
    body = await read_json(request)
    sid = body.get("id") or request.query.get("id")
    if not sid:
        return json_ok({"ok": False, "error": "missing_id"}, status=400)
    result = services.start_service(sid)
    if not result.get("ok"):
        return json_ok(result, status=400)
    return json_ok(result)


async def service_stop_handler(request):
    body = await read_json(request)
    sid = body.get("id") or request.query.get("id")
    if not sid:
        return json_ok({"ok": False, "error": "missing_id"}, status=400)
    return json_ok(services.stop_service(sid))


async def service_logs_handler(request):
    sid = request.query.get("id")
    if not sid:
        return json_ok({"ok": False, "error": "missing_id"}, status=400)
    tail = int(request.query.get("tail") or 200)
    return json_ok(services.read_logs(sid, tail=tail))


async def service_panel_handler(request):
    return json_ok({"services": services.list_panel_state()})


async def token_stats_handler(request):
    try:
        sys.path.insert(0, str(APP_DIR)) if str(APP_DIR) not in sys.path else None
        import cost_tracker
        trackers = cost_tracker.all_trackers()
        records = []
        for k, v in trackers.items():
            model = ''
            sid = k.replace('GA-', '')
            with manager.lock:
                sess = manager.sessions.get(sid)
            if sess and sess.agent:
                try: model = sess.agent.get_llm_name(model=True) or ''
                except Exception: pass
            records.append({"thread": k, "input": v.input, "output": v.output,
                            "cacheCreate": v.cache_create, "cacheRead": v.cache_read, "model": model})
    except Exception:
        records = []
    return json_ok({"records": records})


def create_app():
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/status", status_handler)
    app.router.add_get("/config", get_config_handler)
    app.router.add_post("/config", save_config_handler)
    app.router.add_get("/model-profiles", model_profiles_handler)
    app.router.add_post("/model-profiles", model_profiles_handler)
    app.router.add_get("/model-profiles/{id}", model_profiles_handler)
    app.router.add_put("/model-profiles/{id}", model_profiles_handler)
    app.router.add_delete("/model-profiles/{id}", model_profiles_handler)
    app.router.add_get("/sessions", list_sessions_handler)
    app.router.add_post("/session/new", new_session_handler)
    app.router.add_get("/session/{sid}", get_session_handler)
    app.router.add_delete("/session/{sid}", delete_session_handler)
    app.router.add_post("/session/{sid}/prompt", prompt_handler)
    app.router.add_get("/session/{sid}/messages", messages_handler)
    app.router.add_post("/session/{sid}/cancel", cancel_handler)
    app.router.add_post("/session/{sid}/restore", restore_handler)
    app.router.add_post("/path/open", path_open_handler)
    app.router.add_get("/token-stats", token_stats_handler)
    app.router.add_post("/services/start", service_start_handler)
    app.router.add_post("/services/stop", service_stop_handler)
    app.router.add_get("/services/logs", service_logs_handler)
    app.router.add_get("/services/panel", service_panel_handler)
    app.router.add_get("/services/mykey", mykey_get_handler)
    app.router.add_post("/services/mykey", mykey_save_handler)

    # Serve static frontend (desktop/static/)
    static_dir = APP_DIR / "desktop" / "static"

    async def index_handler(request):
        return web.FileResponse(
            static_dir / "index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    app.router.add_get("/", index_handler)
    app.router.add_static("/", static_dir, show_index=False)

    async def on_startup(app):
        hub.loop = asyncio.get_running_loop()

    app.on_startup.append(on_startup)
    return app


if __name__ == "__main__":
    host = os.environ.get("BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("BRIDGE_PORT", "14168"))
    print(f"GenericAgent Web2 bridge: http://{host}:{port}  ws://{host}:{port}/ws", file=sys.stderr)
    web.run_app(create_app(), host=host, port=port, print=None)
