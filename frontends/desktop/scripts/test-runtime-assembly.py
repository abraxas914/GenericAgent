"""Compare native tar assembly with the base revision on each CI platform."""
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
HELPER = "frontends/desktop/packaging/scripts/runtime-assembly.sh"
WORKFLOW = ".github/workflows/desktop-release-package.yml"
BASE = os.environ["ASSEMBLY_BASE"]
BASH = str(Path(os.environ["ProgramFiles"]) / "Git/bin/bash.exe") if os.name == "nt" else "bash"


def previous(path):
    return subprocess.check_output(
        ["git", "show", f"{BASE}:{path}"], cwd=ROOT, encoding="utf-8",
    )


def snapshot(root):
    return {
        p.relative_to(root).as_posix(): (
            stat.S_IMODE(p.lstat().st_mode),
            os.readlink(p) if p.is_symlink() else p.read_bytes() if p.is_file() else None,
        )
        for p in root.rglob("*")
    }


with tempfile.TemporaryDirectory(prefix="assembly contract ") as temporary:
    temp = Path(temporary)
    source = temp / "source"
    source.mkdir()
    # Use the actual checkout, including nested source trees and hidden files.
    subprocess.run(["git", "checkout-index", "--all", f"--prefix={source.as_posix()}/"], cwd=ROOT, check=True)
    for name in ("nested/node_modules/x", "nested/target/x", ".venv/x",
                 "nested/__pycache__/x.pyc", "nested/loose.pyc", "nested/loose.pyo",
                 "nested/keep file.txt", "nested/run.sh"):
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture\n", encoding="utf-8")
    (source / "nested/run.sh").chmod(0o755)
    if os.name != "nt":
        (source / "nested/link").symlink_to("keep file.txt")

    workflow = previous(WORKFLOW)
    if f"source {HELPER}" in workflow:
        baseline = previous(HELPER) + '\nstage_runtime_source "$RUNTIME"\npurge_runtime_bytecode "$RUNTIME"\n'
    else:
        job = "build-macos" if sys.platform == "darwin" else "build-windows" if os.name == "nt" else "build-linux"
        job_text = workflow.split(f"  {job}:", 1)[1].split("\n  build-", 1)[0]
        purge = re.search(r"          purge_runtime_bytecode\(\) \{\n.*?^          \}", job_text, re.M | re.S)[0]
        stage = re.search(r"          # Runtime source[^\n]*\n.*?test ! -e \"\$(?:RUNTIME|RUNTIME_SRC)/app/frontends/desktop/node_modules\"", job_text, re.S)[0]
        baseline = purge + "\n" + stage + '\npurge_runtime_bytecode "$RUNTIME"\n'
    baseline_path = temp / "baseline.sh"
    baseline_path.write_text(baseline, encoding="utf-8", newline="\n")
    for label in ("before", "after"):
        runtime = temp / label
        runtime.mkdir()
        env = dict(os.environ, RUNTIME=runtime.as_posix(), RUNTIME_SRC=runtime.as_posix())
        script = baseline_path if label == "before" else ROOT / HELPER
        command = 'source "$1"' if label == "before" else 'source "$1"; stage_runtime_source "$RUNTIME"; purge_runtime_bytecode "$RUNTIME"'
        subprocess.run([BASH, "-euo", "pipefail", "-c", command, "assembly", script.as_posix()], cwd=source, env=env, check=True)
    before, after = snapshot(temp / "before"), snapshot(temp / "after")
    assert before == after, "Assembly changed file contents, modes, directories or symlink targets"
    assert "app/nested/keep file.txt" in after
    assert "app/frontends/desktop/static/index.html" in after
    assert not any("__pycache__" in p or p.endswith((".pyc", ".pyo")) for p in after)
    assert "app/nested/node_modules" not in after and "app/nested/target" not in after
    print(f"Assembly matches {BASE}: {len(after)} entries, contents, modes and links")
