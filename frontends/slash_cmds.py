"""Slash-command prompt builders + scheduler-task discovery.

Goal of this module: keep TUI files (tuiapp_v2.py / tui_v3.py) thin. They only
need to forward `/update`, `/autorun`, `/morphling`, `/goal`, `/hive`
to the corresponding `build_*_prompt(args)` here, and ask
`list_scheduler_tasks()` / `start_scheduler_task()` for the `/scheduler` picker.

Design (per user 2026-05-27):
- All non-/scheduler commands are *prompt injection*: we craft a system-style
  request and feed it to the main agent as a normal user message (the TUI is
  free to display the raw `/cmd ...` as the visible bubble).  This keeps the
  agent in-session, lets it use every tool/SOP it normally would, and means
  this file owns zero LLM logic.
- `/scheduler` is the only exception — it touches local FS state directly via
  `sche_tasks/*.json` and the existing scheduler daemon, no LLM needed.
- All prompts deliberately *name* the relevant SOP file so the agent re-reads
  it before acting (per CONSTITUTION rule 2: SOP-first).

This module has zero TUI imports — both frontends can depend on it without
either depending on the other.
"""
from __future__ import annotations

import json
import os
import sys
import subprocess
from pathlib import Path
from typing import Optional


# Repo root = parent of frontends/.  Avoid hard-coding; both TUIs live next to
# this file and share the same anchor.
_ROOT = Path(__file__).resolve().parent.parent


# ----- prompt builders (pure functions, no I/O) ---------------------------
# SOP paths are written inline as literal strings in each builder below: a
# literal is self-documenting and locally readable, and a stale path is a
# zero-radius failure (the prompt is a hint to an intelligent agent, which
# re-reads the dir / asks if a SOP moved) — so we deliberately do NOT wrap it
# in a registry + existence-check machinery.

def _tail(args_text: str, label: str = "额外指示") -> str:
    """Append user-supplied args after a slash command as a free-form suffix.

    User pattern (2026-05-27): the base prompt is a fixed injection that names
    the SOP path; anything the user types after `/cmd ` is appended verbatim so
    they can add per-invocation hints (e.g. `/morphling https://github.com/...`
    or `/goal 调研 X，预算 50k token`).
    """
    extra = (args_text or "").strip()
    return f"\n\n{label}: {extra}" if extra else ""


def build_update_prompt(args_text: str = "") -> str:
    # Faithfully follow the user's own wording (2026-05-27):
    # "git pull 更新一下 GA 你自己，官方渠道 https://github.com/Lsdefine/GenericAgent,
    #  自动合并解决冲突,优先上游分支,本地修改代码也进行保留但不进行 commit."
    return (
        "请你 git pull 更新一下 GA 你自己，官方渠道 "
        "https://github.com/Lsdefine/GenericAgent ，"
        "自动合并解决冲突，优先上游分支，本地修改代码也进行保留但不进行 commit。"
        f"{_tail(args_text)}"
    )


def build_autorun_prompt(args_text: str = "") -> str:
    return (
        "请进入「自主探索 / autonomous 模式」：先读 "
        "memory/autonomous_operation_sop.md。"
        "全程自驱，不可逆 / 高风险动作先 ask_user ，"
        "结案给一份简明回执（做了什么 / 产物在哪 / 下一步）。"
        f"{_tail(args_text, '任务种子')}"
    )


def build_morphling_prompt(args_text: str = "") -> str:
    return (
        "请启用 Morphling 模式吞噬 / 蒸馏外部项目到本仓库：先读 "
        "memory/morphling_sop.md。"
        "没有目标先 ask_user 取 GitHub 仓库 / 本地路径 / 能力描述。"
        f"{_tail(args_text, '目标技能/仓库')}"
    )


def build_goal_prompt(args_text: str = "") -> str:
    return (
        "请进入 Goal 模式：先读 memory/goal_mode_sop.md。"
        "若未给目标，先 ask_user 一次性问清：一句话目标 + condition 约束。"
        f"{_tail(args_text, '用户目标')}"
    )


def build_hive_prompt(args_text: str = "") -> str:
    return (
        "请进入 Goal Hive 模式（多 worker 协作版 goal）：先读 "
        "memory/goal_hive_sop.md。"
        "集群目标 / worker 配额 / 终止条件未明确时先 ask_user 补齐再启动。"
        f"{_tail(args_text, '集群目标')}"
    )


# ----- /scheduler reflect-task discovery + launch -------------------------

def list_reflect_tasks() -> list[dict]:
    """Return [{name, path, doc}] for every reflect/*.py task script.

    `doc` is the module docstring's first line (best-effort) so the picker can
    show a one-liner next to each name.  Empty list if reflect/ doesn't exist.
    """
    out: list[dict] = []
    refl = _ROOT / "reflect"
    if not refl.is_dir():
        return out
    for p in sorted(refl.glob("*.py")):
        if p.name.startswith("_"):
            continue
        doc = ""
        try:
            # Cheap docstring sniff: read first ~40 lines, look for """...""".
            head = p.read_text(encoding="utf-8", errors="ignore").splitlines()[:40]
            joined = "\n".join(head)
            for q in ('"""', "'''"):
                i = joined.find(q)
                if i != -1:
                    j = joined.find(q, i + 3)
                    if j != -1:
                        doc = joined[i + 3:j].strip().splitlines()[0].strip()
                        break
        except Exception:
            pass
        out.append({"name": p.stem, "path": str(p), "doc": doc})
    return out


def list_scheduler_tasks() -> list[dict]:
    """Return [{name, path, schedule, enabled}] for every sche_tasks/*.json.

    Used by the /scheduler picker so users can also toggle traditional cron
    tasks, not just reflect.* scripts.
    """
    out: list[dict] = []
    sd = _ROOT / "sche_tasks"
    if not sd.is_dir():
        return out
    for p in sorted(sd.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        out.append({
            "name": p.stem,
            "path": str(p),
            "schedule": data.get("schedule") or data.get("cron") or data.get("every") or "",
            "enabled": bool(data.get("enabled", True)),
        })
    return out


def start_reflect_task(name: str) -> tuple[bool, str]:
    """Spawn `python reflect/<name>.py` detached.  Returns (ok, message).

    Detached because reflect tasks are long-running; we don't want them to die
    with the TUI.  On Windows we use CREATE_NEW_PROCESS_GROUP|CREATE_NO_WINDOW
    so no console pops up (per CONSTITUTION rule 14: only at launch layer, no
    monkeypatching subprocess.Popen).
    """
    script = _ROOT / "reflect" / f"{name}.py"
    if not script.is_file():
        return False, f"reflect/{name}.py 不存在"
    try:
        flags = 0
        if os.name == "nt":
            flags = 0x00000200 | 0x08000000  # NEW_PROCESS_GROUP | NO_WINDOW
        subprocess.Popen(
            [sys.executable, str(script)],
            cwd=str(_ROOT),
            creationflags=flags,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
        return True, f"已启动 reflect/{name}.py"
    except Exception as e:
        return False, f"启动失败: {type(e).__name__}: {e}"


# ----- dispatch table for the TUI to register against ---------------------

# (cmd, arg_hint, desc)  — kept identical between v2 and v3 so the palette
# stays consistent across frontends.
PALETTE_ENTRIES: list[tuple[str, str, str]] = [
    ("/update",    "[note]",    "git pull 更新 GA 仓库并报告影响面"),
    ("/autorun",   "[seed]",    "进入 autonomous_operation 自主模式"),
    ("/morphling", "[target]",  "启用 Morphling 蒸馏 / 吞噬外部技能"),
    ("/goal",      "[goal]",    "进入 Goal 模式（需 condition 约束）"),
    ("/hive",      "[target]",  "进入 Hive 多 worker 协作模式"),
    ("/scheduler", "",          "多选启动 reflect 任务 / 查看 cron"),
]


def prompt_for(cmd: str, args_text: str) -> Optional[str]:
    """Return the injected user-message for a given slash command, or None if
    the command isn't one of ours (e.g. /scheduler — handled by TUI directly).
    """
    table = {
        "/update":    build_update_prompt,
        "/autorun":   build_autorun_prompt,
        "/morphling": build_morphling_prompt,
        "/goal":      build_goal_prompt,
        "/hive":      build_hive_prompt,
    }
    fn = table.get(cmd)
    return fn(args_text) if fn else None
