#!/usr/bin/env bash
# Build-only helpers. Source from the repository root with set -euo pipefail.
# Keep native tar so source modes and symlinks retain platform packaging semantics.

purge_runtime_bytecode() {
  local runtime_root="$1"
  find "$runtime_root" -type d -name '__pycache__' -prune -exec rm -rf {} +
  find "$runtime_root" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
  if find "$runtime_root" -type d -name '__pycache__' -print -quit | grep -q .; then
    echo "Python bytecode cache directory remains in packaged runtime: $runtime_root" >&2
    return 1
  fi
  if find "$runtime_root" -type f \( -name '*.pyc' -o -name '*.pyo' \) -print -quit | grep -q .; then
    echo "Python bytecode remains in packaged runtime: $runtime_root" >&2
    return 1
  fi
}

stage_runtime_source() {
  local RUNTIME="$1"
  mkdir -p "$RUNTIME/app"
  local -a excludes=(
    --exclude='./.git' --exclude='./.github'
    --exclude='./frontends/tests'
    --exclude='./frontends/desktop/src-tauri'
    --exclude='./frontends/desktop/src'
    --exclude='./frontends/desktop/public'
    --exclude='./frontends/desktop/scripts'
    --exclude='./frontends/desktop/e2e'
    --exclude='./frontends/desktop/tests'
    --exclude='./frontends/desktop/testing'
    --exclude='./frontends/desktop/spec'
    --exclude='./frontends/desktop/node_modules'
    --exclude='./frontends/desktop/dist'
    --exclude='./frontends/desktop/DESIGN.md'
    --exclude='./frontends/desktop/package.json'
    --exclude='./frontends/desktop/package-lock.json'
    --exclude='./frontends/desktop/.npmrc'
    --exclude='./frontends/desktop/index.html'
    --exclude='./frontends/desktop/loading.html'
    --exclude='./frontends/desktop/setup.html'
    --exclude='./frontends/desktop/tsconfig*.json'
    --exclude='./frontends/desktop/vite.config.ts'
    --exclude='./frontends/desktop/packaging' --exclude='./docs'
    --exclude='./assets/demo' --exclude='./assets/images'
    --exclude='./assets/GenericAgent_Technical_Report.pdf'
    --exclude='./artifacts'
    --exclude='*/node_modules' --exclude='*/target'
    --exclude='*/.venv' --exclude='./.venv'
    --exclude='*/__pycache__' --exclude='*.pyc'
  )
  # BSD tar matches root entries without GNU tar's leading ./.
  if [[ "$(uname -s)" == Darwin ]]; then
    local i
    for i in "${!excludes[@]}"; do
      if [[ "${excludes[$i]}" == --exclude=./* ]]; then
        excludes[$i]="--exclude=${excludes[$i]#--exclude=./}"
      fi
    done
  fi
  tar "${excludes[@]}" -cf - . | tar -xf - -C "$RUNTIME/app"
  test -f "$RUNTIME/app/agentmain.py"
  test -f "$RUNTIME/app/frontends/desktop_bridge.py"
  test -f "$RUNTIME/app/frontends/desktop/static/index.html"
  test ! -e "$RUNTIME/app/frontends/desktop/dist"
  test ! -e "$RUNTIME/app/frontends/desktop/src"
  test ! -e "$RUNTIME/app/frontends/desktop/public"
  test ! -e "$RUNTIME/app/frontends/desktop/package-lock.json"
  test ! -e "$RUNTIME/app/frontends/desktop/node_modules"
}
