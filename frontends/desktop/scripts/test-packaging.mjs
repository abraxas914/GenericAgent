#!/usr/bin/env node
/**
 * test-packaging.mjs — Pre-packaging validation.
 *
 * Verifies that packaging prerequisites are in order before attempting
 * a Tauri build. Checks tauri.conf.json semantics, icon file existence,
 * and packaging script syntax.
 *
 * Usage:
 *   node scripts/test-packaging.mjs
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..');
const TAURI_DIR = path.join(DESKTOP_ROOT, 'src-tauri');
const PACKAGING_DIR = path.join(DESKTOP_ROOT, 'packaging');

let pass = 0;
let fail = 0;
const warnings = [];
const RELEASE_VERSION = '0.2.0';

function ok(msg) { console.log(`  ✓ ${msg}`); pass++; }
function bad(msg) { console.error(`  ✗ ${msg}`); fail++; }
function warn(msg) { console.warn(`  ⚠ ${msg}`); warnings.push(msg); }

function collectFilesByExtension(root, extension) {
  const ignoredDirectories = new Set(['dist', 'node_modules', 'target']);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function processFailureDetails(error) {
  const output = [error.stderr, error.stdout]
    .map((value) => value?.toString().trim())
    .filter(Boolean)
    .join('\n');
  return output ? `${error.message}\n${output}` : error.message;
}

function windowsPbsArchiveUsesPosixTempPath(workflow) {
  return (workflow.match(/command -v cygpath >\/dev\/null 2>&1/g) ?? []).length === 1
    && (workflow.match(/RUNNER_TEMP_POSIX="\$\(cygpath -u "\$RUNNER_TEMP"\)"/g) ?? []).length === 1
    && (workflow.match(/\[\[ "\$RUNNER_TEMP_POSIX" == \/\* \]\]/g) ?? []).length === 1
    && (workflow.match(/PBS_ARCHIVE="\$\{RUNNER_TEMP_POSIX\}\/pbs-windows-x86_64\.tar\.gz"/g) ?? []).length === 1
    && !workflow.includes('PBS_ARCHIVE="${RUNNER_TEMP}/pbs-windows-x86_64.tar.gz"');
}

function workflowJob(workflow, name) {
  const header = new RegExp(`^  ${name}:\\s*$`, 'm');
  const match = header.exec(workflow);
  if (!match) return '';
  const remainder = workflow.slice(match.index + match[0].length);
  const nextJob = /^  [a-zA-Z0-9_-]+:\s*$/m.exec(remainder);
  return nextJob ? remainder.slice(0, nextJob.index) : remainder;
}

function packagedRuntimeBytecodeContract(workflow) {
  const specs = [
    ['build-windows', ['purge_runtime_bytecode "$RUNTIME"']],
    ['build-linux', ['purge_runtime_bytecode "$RUNTIME"']],
    ['build-macos', [
      'purge_runtime_bytecode "$RUNTIME_SRC"',
      'purge_runtime_bytecode "$DMG_RUNTIME"',
    ]],
  ];
  return (workflow.match(/^  PYTHONDONTWRITEBYTECODE: "1"$/gm) ?? []).length === 1
    && specs.every(([jobName, calls]) => {
      const job = workflowJob(workflow, jobName);
      return job.includes('purge_runtime_bytecode() {')
        && job.includes('find "$runtime_root" -type d -name \'__pycache__\'')
        && job.includes('find "$runtime_root" -type f \\( -name \'*.pyc\' -o -name \'*.pyo\' \\) -delete')
        && calls.every((call) => job.includes(call))
        && !/pip[\\/]_vendor/.test(job);
    });
}

function prunedRuntimeSourceContract(job) {
  const normalized = job.replaceAll("--exclude='./", "--exclude='");
  const excluded = [
    'frontends/tests',
    'frontends/desktop/src',
    'frontends/desktop/public',
    'frontends/desktop/scripts',
    'frontends/desktop/e2e',
    'frontends/desktop/tests',
    'frontends/desktop/testing',
    'frontends/desktop/spec',
    'frontends/desktop/DESIGN.md',
    'frontends/desktop/package.json',
    'frontends/desktop/package-lock.json',
    'frontends/desktop/node_modules',
  ];
  return excluded.every((entry) => normalized.includes(`--exclude='${entry}'`))
    && !normalized.includes("--exclude='frontends/desktop/static'")
    && normalized.includes('frontends/desktop/static/index.html')
    && normalized.includes('frontends/desktop/package-lock.json"')
    && normalized.includes('frontends/desktop/node_modules"');
}

// ── 1. tauri.conf.json validation ──
console.log('\n[1] tauri.conf.json');

const confPath = path.join(TAURI_DIR, 'tauri.conf.json');
if (!fs.existsSync(confPath)) {
  bad('tauri.conf.json not found');
} else {
  let conf;
  try {
    conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    ok('tauri.conf.json is valid JSON');
  } catch (e) {
    bad(`tauri.conf.json parse error: ${e.message}`);
  }

  if (conf) {
    if (conf.productName && conf.productName.length > 0) {
      ok(`productName: "${conf.productName}"`);
    } else {
      bad('productName is missing or empty');
    }

    if (conf.version && /^\d+\.\d+\.\d+/.test(conf.version)) {
      ok(`version: ${conf.version}`);
    } else {
      bad(`version "${conf.version}" is not semver`);
    }

    if (conf.build?.frontendDist) {
      ok(`frontendDist: ${conf.build.frontendDist}`);
    } else {
      bad('build.frontendDist is not set');
    }

    if (conf.bundle?.targets?.length > 0) {
      ok(`bundle targets: [${conf.bundle.targets.join(', ')}]`);
    } else {
      warn('no bundle targets specified');
    }
  }
}

// ── 2. Icon files ──
console.log('\n[2] Icon files');

const iconsDir = path.join(TAURI_DIR, 'icons');
if (!fs.existsSync(iconsDir)) {
  bad('src-tauri/icons/ directory not found');
} else {
  const confIcons = JSON.parse(fs.readFileSync(confPath, 'utf8')).bundle?.icon || [];
  let allFound = true;
  for (const iconRef of confIcons) {
    const iconPath = path.join(TAURI_DIR, iconRef);
    if (fs.existsSync(iconPath)) {
      ok(`icon exists: ${iconRef}`);
    } else {
      bad(`icon missing: ${iconRef}`);
      allFound = false;
    }
  }
  if (confIcons.length === 0) {
    warn('no icons specified in bundle.icon');
  }
}

// ── 3. Packaging scripts syntax ──
console.log('\n[3] Packaging scripts');

const scriptsDir = path.join(PACKAGING_DIR, 'scripts');
if (!fs.existsSync(scriptsDir)) {
  warn('packaging/scripts/ not found');
} else {
  const shScripts = [];
  for (const platform of ['linux', 'macos', 'windows']) {
    const dir = path.join(scriptsDir, platform);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.sh')) shScripts.push(path.join(dir, f));
    }
  }

  for (const script of shScripts) {
    try {
      execSync(`bash -n "${script}" 2>&1`, { timeout: 5000 });
      ok(`syntax OK: ${path.relative(DESKTOP_ROOT, script)}`);
    } catch (e) {
      bad(`syntax error: ${path.relative(DESKTOP_ROOT, script)}\n    ${e.stdout?.toString().trim() || e.message}`);
    }
  }

  const powershellScripts = collectFilesByExtension(DESKTOP_ROOT, '.ps1');
  const powershellInputs = powershellScripts.map((script) => ({
    path: script,
    label: path.relative(DESKTOP_ROOT, script),
  }));
  const powershellParserCommand = [
    "$ErrorActionPreference = 'Stop'",
    '$scripts = @($env:GA_DESKTOP_PWSH_SCRIPTS | ConvertFrom-Json)',
    '$failed = $false',
    'foreach ($script in $scripts) {',
    '  $scriptPath = [string]$script.path',
    '  $scriptLabel = [string]$script.label',
    "  Write-Output ('parsing PowerShell: {0}' -f $scriptLabel)",
    '  try {',
    '    $tokens = $null',
    '    $parseErrors = $null',
    '    [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors) > $null',
    '    foreach ($parseError in @($parseErrors)) {',
    '      $failed = $true',
    "      [Console]::Error.WriteLine(('{0}:{1}:{2}: {3}' -f $scriptLabel, $parseError.Extent.StartLineNumber, $parseError.Extent.StartColumnNumber, $parseError.Message))",
    '    }',
    '  } catch {',
    '    $failed = $true',
    "    [Console]::Error.WriteLine(('{0}: {1}' -f $scriptLabel, $_.Exception.Message))",
    '  }',
    '}',
    'if ($failed) { exit 1 }',
  ].join('\n');

  if (powershellScripts.length === 0) {
    warn('no PowerShell scripts were found for parser checks');
  } else {
    try {
      execFileSync(
        'pwsh',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powershellParserCommand],
        {
          timeout: 30_000,
          stdio: 'pipe',
          env: {
            ...process.env,
            GA_DESKTOP_PWSH_SCRIPTS: JSON.stringify(powershellInputs),
          },
        },
      );
      for (const script of powershellScripts) {
        ok(`syntax OK: ${path.relative(DESKTOP_ROOT, script)}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        warn('pwsh is unavailable; PowerShell parser checks were skipped');
      } else {
        bad(`PowerShell parser check failed for ${powershellInputs.map(({ label }) => label).join(', ')}\n    ${processFailureDetails(error)}`);
      }
    }
  }

  for (const relative of [
    'scripts/post-dmg.sh',
    'e2e/linux/Invoke-LinuxUserJourney.sh',
    'e2e/macos/Invoke-macOSUserJourney.sh',
  ]) {
    const script = path.join(DESKTOP_ROOT, relative);
    try {
      execFileSync('bash', ['-n', script], { timeout: 5000 });
      ok(`syntax OK: ${relative}`);
    } catch (e) {
      bad(`syntax error: ${relative}\n    ${e.stderr?.toString().trim() || e.message}`);
    }
  }

  for (const relative of [
    'packaging/scripts/merge_desktop_settings.py',
    'scripts/gen_ds_store.py',
    'e2e/package/real_package_journey.py',
    'e2e/package/verify_candidate_evidence.py',
  ]) {
    const script = path.join(DESKTOP_ROOT, relative);
    try {
      execFileSync('python3', [
        '-c',
        'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), filename=sys.argv[1])',
        script,
      ], { timeout: 5000, stdio: 'ignore' });
      ok(`syntax OK: ${relative}`);
    } catch (e) {
      bad(`syntax error: ${relative}: ${e.message}`);
      continue;
    }
    if (relative.startsWith('e2e/')) {
      try {
        execFileSync('python3', [script, '--help'], { timeout: 5000, stdio: 'ignore' });
        ok(`CLI contract OK: ${relative}`);
      } catch (e) {
        bad(`CLI contract failed: ${relative}: ${e.message}`);
      }
    }
  }
}

// ── 4. Locked package inputs ──
console.log('\n[4] Locked package inputs');

const releaseWorkflow = fs.readFileSync(
  path.join(REPO_ROOT, '.github', 'workflows', 'desktop-release-package.yml'),
  'utf8',
);
const packageManifest = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, 'package-lock.json'), 'utf8'));
const packagingTauriConfig = JSON.parse(fs.readFileSync(confPath, 'utf8'));
const distIntegrityScript = fs.readFileSync(path.join(DESKTOP_ROOT, 'scripts', 'assert-dist-built.mjs'), 'utf8');
const gitAttributes = fs.readFileSync(path.join(REPO_ROOT, '.gitattributes'), 'utf8');
if (packageManifest.devDependencies?.['@tauri-apps/cli'] === '2.11.4'
    && packageLock.packages?.['']?.devDependencies?.['@tauri-apps/cli'] === '2.11.4'
    && packageLock.packages?.['node_modules/@tauri-apps/cli']?.version === '2.11.4') {
  ok('@tauri-apps/cli is exactly pinned to 2.11.4 in the manifest and lockfile');
} else {
  bad('@tauri-apps/cli must be exactly pinned to 2.11.4');
}
const noticeAttributeRules = [
  'frontends/desktop/public/THIRD_PARTY_NOTICES.txt text eol=lf',
  'frontends/desktop/dist/THIRD_PARTY_NOTICES.txt text eol=lf',
];
if (noticeAttributeRules.every((rule) => gitAttributes.split(/\r?\n/).filter((line) => line === rule).length === 1)) {
  ok('source and compiled third-party notices each have one exact LF attribute rule');
} else {
  bad('third-party notice LF attribute rules are missing, duplicated, or conflicting');
}
if (
  packageManifest.scripts?.['test:bundle'] === 'node scripts/assert-dist-built.mjs'
    && packageManifest.scripts?.['build:tauri-assets'] === 'npm run build && npm run test:bundle'
    && packagingTauriConfig.build?.beforeBuildCommand === 'npm run build:tauri-assets'
    && distIntegrityScript.includes('sha256(builtPath) !== expectedHash')
) {
  ok('Tauri frontend build runs the cross-platform dist hash contract before embedding');
} else {
  bad('Tauri frontend build can embed dist without the exact notice hash contract');
}
for (const command of [
  'npm run tauri build -- --bundles nsis',
  'npm run tauri build -- --bundles appimage',
  'npm run tauri build -- --bundles app',
]) {
  if (releaseWorkflow.includes(`        run: ${command}\n`)) {
    ok(`release packaging consumes the notice-gated Tauri command: ${command}`);
  } else {
    bad(`release packaging is missing the notice-gated Tauri command: ${command}`);
  }
}
for (const jobName of ['build-windows', 'build-linux', 'build-macos']) {
  const job = workflowJob(releaseWorkflow, jobName);
  if (job.includes('npm ci')
      && job.includes("node -e \"const v=require('./node_modules/@tauri-apps/cli/package.json').version; if(v!=='2.11.4')")) {
    ok(`${jobName} installs the lockfile and asserts Tauri CLI 2.11.4`);
  } else {
    bad(`${jobName} does not assert the exact installed Tauri CLI`);
  }
  if (prunedRuntimeSourceContract(job)) {
    ok(`${jobName} excludes frontend/development source and retains Desktop v1 static`);
  } else {
    bad(`${jobName} runtime source pruning is incomplete or excludes Desktop v1 static`);
  }
}

if (windowsPbsArchiveUsesPosixTempPath(releaseWorkflow)) {
  ok('Windows PBS archive uses an asserted absolute POSIX runner temp path');
} else {
  bad('Windows PBS archive can expose a raw drive-letter path to POSIX tools');
}
const unsafeWindowsWorkflow = releaseWorkflow.replace(
  'PBS_ARCHIVE="${RUNNER_TEMP_POSIX}/pbs-windows-x86_64.tar.gz"',
  'PBS_ARCHIVE="${RUNNER_TEMP}/pbs-windows-x86_64.tar.gz"',
);
if (!windowsPbsArchiveUsesPosixTempPath(unsafeWindowsWorkflow)) {
  ok('Windows PBS archive contract rejects a raw drive-letter runner temp path');
} else {
  bad('Windows PBS archive contract accepted an unsafe raw runner temp path');
}

const runtimeRequirementsPath = path.join(PACKAGING_DIR, 'python-runtime-requirements.txt');
const dmgRequirementsPath = path.join(PACKAGING_DIR, 'dmg-build-requirements.txt');
if (!fs.existsSync(runtimeRequirementsPath)) {
  bad('packaging/python-runtime-requirements.txt is missing');
} else {
  const requirements = fs.readFileSync(runtimeRequirementsPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const invalid = requirements.filter((line) => !/^[a-z0-9][a-z0-9._-]*==[^\s]+$/i.test(line));
  if (requirements.length > 20 && invalid.length === 0) {
    ok(`${requirements.length} runtime requirements use exact versions`);
  } else {
    bad(`runtime requirements must be a complete exact lock; invalid: ${invalid.join(', ') || 'too few entries'}`);
  }
  const names = new Set(requirements.map((line) => line.split('==', 1)[0].toLowerCase()));
  for (const name of ['requests', 'beautifulsoup4', 'bottle', 'simple-websocket-server', 'aiohttp', 'psutil', 'fastapi', 'uvicorn', 'websockets', 'pydantic']) {
    if (names.has(name)) ok(`runtime lock includes ${name}`);
    else bad(`runtime lock is missing ${name}`);
  }
  if (!names.has('setuptools') && !names.has('wheel')) {
    ok('binary-only runtime wheelhouse excludes setuptools and wheel');
  } else {
    bad('binary-only runtime wheelhouse must exclude setuptools and wheel');
  }
}

if (!fs.existsSync(dmgRequirementsPath)) {
  bad('packaging/dmg-build-requirements.txt is missing');
} else {
  const requirements = fs.readFileSync(dmgRequirementsPath, 'utf8');
  const hashes = requirements.match(/--hash=sha256:[0-9a-f]{64}/g) ?? [];
  if (requirements.includes('ds-store==1.3.3') && requirements.includes('mac-alias==2.2.3') && hashes.length === 2) {
    ok('DMG build requirements use exact versions and SHA-256 hashes');
  } else {
    bad('DMG build requirements are not fully pinned and hash-locked');
  }
}

for (const relative of [
  'scripts/windows/install_windows.ps1',
  'scripts/linux/install_linux.sh',
  'scripts/macos/install_macos.sh',
]) {
  const content = fs.readFileSync(path.join(PACKAGING_DIR, relative), 'utf8');
  const hasWholeRuntimeCleanup = relative.endsWith('.ps1')
    ? content.includes('Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter "__pycache__" -Recurse')
      && content.includes("$_.Name -match '\\.py[co]$'")
    : content.includes('find "$runtime_root" -type d -name \'__pycache__\'')
      && content.includes('find "$runtime_root" -type f \\( -name \'*.pyc\' -o -name \'*.pyo\' \\) -delete');
  if (content.includes('requirements.txt')
      && content.includes('--requirement')
      && content.includes('PYTHONDONTWRITEBYTECODE')
      && content.includes('--no-compile')
      && content.includes('merge_desktop_settings.py')
      && hasWholeRuntimeCleanup
      && !/pip[\\/]_vendor/.test(content)) {
    ok(`offline installer preserves settings and leaves the whole runtime bytecode-free: ${relative}`);
  } else {
    bad(`offline installer contract is incomplete: ${relative}`);
  }
}
const windowsInstallScript = fs.readFileSync(
  path.join(PACKAGING_DIR, 'scripts', 'windows', 'install_windows.ps1'),
  'utf8',
);
if (windowsInstallScript.includes('npm install --package-lock=false')) {
  ok('Windows source installer does not generate a package-lock.json');
} else {
  bad('Windows source installer can generate a package-lock.json');
}

if (releaseWorkflow.includes('Windows portable build is not code-signed')
    && releaseWorkflow.includes('SmartScreen may warn')
    && releaseWorkflow.includes('SHA256SUMS-windows.txt')) {
  ok('Windows package documentation discloses unsigned SmartScreen behavior and checksum verification');
} else {
  bad('Windows package documentation overstates signing or omits checksum guidance');
}

for (const relative of [
  'scripts/windows/uninstall_windows.ps1',
  'scripts/linux/uninstall.sh',
  'scripts/macos/uninstall.command',
]) {
  const content = fs.readFileSync(path.join(PACKAGING_DIR, relative), 'utf8');
  const noSharedDelete = !content.includes('Remove-Item -LiteralPath $settings -Force')
    && !content.includes('rm -f "$HOME/.ga_desktop_settings.json"');
  if (content.includes('/services/identity')
      && content.includes('/services/bridge/exit')
      && content.includes('merge_desktop_settings.py')
      && content.includes('--remove-bundle')
      && noSharedDelete) {
    ok(`uninstaller checks bridge ownership and preserves shared settings: ${relative}`);
  } else {
    bad(`uninstaller can affect another bundle or shared settings: ${relative}`);
  }
}

if (packagedRuntimeBytecodeContract(releaseWorkflow)) {
  ok('all three package builders purge bytecode across each complete runtime');
} else {
  bad('package builders do not enforce whole-runtime bytecode cleanup');
}

for (const marker of [
  '首次启动会离线校验并补齐随包 Python 运行时依赖',
  '若需强制重新准备，请删除 runtime\\.prepared 后重启',
  '若需强制重新准备，请删除 runtime/.prepared 后重启',
  'The first launch verifies and completes the bundled Python runtime offline',
  'preparation pass, delete runtime\\.prepared and relaunch',
  'preparation pass, delete runtime/.prepared and relaunch',
]) {
  if (releaseWorkflow.includes(marker)) ok(`portable README includes accurate runtime guidance: ${marker}`);
  else bad(`portable README is missing accurate runtime guidance: ${marker}`);
}
if (!releaseWorkflow.includes('creates a venv')
    && !releaseWorkflow.includes('runtime\\app\\.venv')
    && !releaseWorkflow.includes('runtime/app/.venv')) {
  ok('portable READMEs do not claim the embedded runtime creates an app venv');
} else {
  bad('portable READMEs still describe the obsolete app venv flow');
}
for (const [label, mutation] of [
  ['missing no-bytecode environment', releaseWorkflow.replace('  PYTHONDONTWRITEBYTECODE: "1"\n', '')],
  ['site-packages-only cleanup', releaseWorkflow.replace(
    'purge_runtime_bytecode "$RUNTIME"',
    'purge_runtime_bytecode "$RUNTIME/python/lib/python3.12/site-packages"',
  )],
  ['pyc-only cleanup', releaseWorkflow.replace(" -o -name '*.pyo'", '')],
]) {
  if (!packagedRuntimeBytecodeContract(mutation)) {
    ok(`runtime cleanup contract rejects ${label}`);
  } else {
    bad(`runtime cleanup contract accepted ${label}`);
  }
}

const settingsHelper = path.join(PACKAGING_DIR, 'scripts', 'merge_desktop_settings.py');
const settingsSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-desktop-settings-'));
try {
  const settingsPath = path.join(settingsSandbox, '.ga_desktop_settings.json');
  const original = {
    python_path: '/old/python',
    project_dir: '/old/project',
    bridge_script: '/old/bridge.py',
    ga_source_override: '/external/GenericAgent',
    conductor_model_index: 3,
    conductor: { llmNo: 4 },
    desktop_shortcut: true,
    unknown: { nested: ['keep-me'] },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(original), 'utf8');
  execFileSync('python3', [
    settingsHelper,
    '--settings', settingsPath,
    '--python-path', '/runtime/python',
    '--project-dir', REPO_ROOT,
    '--bridge-script', path.join(REPO_ROOT, 'frontends', 'desktop_bridge.py'),
  ], {
    timeout: 5000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  const merged = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const expected = {
    ...original,
    python_path: '/runtime/python',
    project_dir: REPO_ROOT,
    bridge_script: path.join(REPO_ROOT, 'frontends', 'desktop_bridge.py'),
  };
  const residue = fs.readdirSync(settingsSandbox).filter((name) => name !== path.basename(settingsPath));
  if (JSON.stringify(merged) === JSON.stringify(expected) && residue.length === 0) {
    ok('atomic settings merge updates only the three package path keys');
  } else {
    bad('atomic settings merge dropped sibling settings or left a temporary file');
  }

  const owned = {
    ...expected,
    python_path: '/bundle-one/runtime/python/bin/python3',
    project_dir: '/bundle-one/runtime/app',
    bridge_script: '/bundle-one/runtime/app/frontends/desktop_bridge.py',
    ga_source_override: '/bundle-two/external-core',
  };
  fs.writeFileSync(settingsPath, JSON.stringify(owned), 'utf8');
  execFileSync('python3', [
    settingsHelper,
    '--settings', settingsPath,
    '--project-dir', REPO_ROOT,
    '--remove-bundle', '/bundle-one',
  ], { timeout: 5000 });
  const detached = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!('python_path' in detached)
      && !('project_dir' in detached)
      && !('bridge_script' in detached)
      && detached.ga_source_override === owned.ga_source_override
      && detached.desktop_shortcut === true
      && JSON.stringify(detached.unknown) === JSON.stringify(owned.unknown)) {
    ok('uninstall detaches only this bundle paths and preserves shared preferences');
  } else {
    bad('uninstall settings merge removed shared preferences or external source selection');
  }

  const secondBundle = {
    ...owned,
    python_path: '/bundle-two/runtime/python/bin/python3',
    project_dir: '/bundle-two/runtime/app',
    bridge_script: '/bundle-two/runtime/app/frontends/desktop_bridge.py',
  };
  fs.writeFileSync(settingsPath, JSON.stringify(secondBundle), 'utf8');
  execFileSync('python3', [
    settingsHelper,
    '--settings', settingsPath,
    '--project-dir', REPO_ROOT,
    '--remove-bundle', '/bundle-one',
  ], { timeout: 5000 });
  if (JSON.stringify(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))) === JSON.stringify(secondBundle)) {
    ok('uninstall leaves a second bundle settings selection untouched');
  } else {
    bad('uninstall detached settings owned by a second bundle');
  }

  const malformed = '{"ga_source_override":';
  fs.writeFileSync(settingsPath, malformed, 'utf8');
  let rejected = false;
  try {
    execFileSync('python3', [
      settingsHelper,
      '--settings', settingsPath,
      '--python-path', '/runtime/python',
      '--project-dir', REPO_ROOT,
      '--bridge-script', path.join(REPO_ROOT, 'frontends', 'desktop_bridge.py'),
    ], { timeout: 5000, stdio: 'ignore' });
  } catch {
    rejected = true;
  }
  if (rejected && fs.readFileSync(settingsPath, 'utf8') === malformed) {
    ok('atomic settings merge rejects malformed input without replacing it');
  } else {
    bad('atomic settings merge overwrote malformed input');
  }
} finally {
  fs.rmSync(settingsSandbox, { recursive: true, force: true });
}

const noHostPythonSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-no-host-python-'));
try {
  const runtimeRoot = path.join(noHostPythonSandbox, 'runtime');
  const projectRoot = path.join(runtimeRoot, 'app');
  const runtimePython = path.join(runtimeRoot, 'python', 'bin', 'python3');
  const wheelDir = path.join(runtimeRoot, 'wheels');
  const fakePath = path.join(noHostPythonSandbox, 'bin');
  const fakeHome = path.join(noHostPythonSandbox, 'home');
  fs.mkdirSync(path.join(projectRoot, 'frontends'), { recursive: true });
  fs.mkdirSync(path.dirname(runtimePython), { recursive: true });
  fs.mkdirSync(wheelDir, { recursive: true });
  fs.mkdirSync(fakePath, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'agentmain.py'), '# test\n');
  fs.writeFileSync(path.join(projectRoot, 'frontends', 'desktop_bridge.py'), '# test\n');
  fs.copyFileSync(path.join(REPO_ROOT, 'frontends', 'desktop_settings.py'), path.join(projectRoot, 'frontends', 'desktop_settings.py'));
  const hostPython = execFileSync(
    '/bin/sh',
    ['-c', 'command -v python3.12 || command -v python3.11 || command -v python3.10'],
    { encoding: 'utf8' },
  ).trim();
  fs.copyFileSync(fs.realpathSync(hostPython), runtimePython);
  fs.chmodSync(runtimePython, 0o755);
  for (const tool of ['basename', 'cp', 'dirname', 'find', 'grep', 'readlink', 'sed', 'uname']) {
    const resolved = execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
    fs.symlinkSync(resolved, path.join(fakePath, tool));
  }
  execFileSync('/bin/bash', [
    path.join(PACKAGING_DIR, 'scripts', 'linux', 'install_linux.sh'),
    '--python-path', runtimePython,
    '--project-dir', projectRoot,
    '--wheel-dir', wheelDir,
    '--mode', 'PrepareOnly',
    '--no-venv',
    '--skip-pip-install',
  ], {
    timeout: 15_000,
    stdio: 'pipe',
    env: { HOME: fakeHome, PATH: fakePath },
  });
  const written = JSON.parse(fs.readFileSync(path.join(fakeHome, '.ga_desktop_settings.json'), 'utf8'));
  if (fs.realpathSync(written.python_path) === fs.realpathSync(runtimePython)
      && fs.realpathSync(written.project_dir) === fs.realpathSync(projectRoot)) {
    ok('Linux PrepareOnly works with only the explicit embedded Python on PATH');
  } else {
    bad('Linux PrepareOnly did not preserve the explicit embedded Python paths');
  }
} catch (error) {
  bad(`Linux PrepareOnly required a host python3: ${processFailureDetails(error)}`);
} finally {
  fs.rmSync(noHostPythonSandbox, { recursive: true, force: true });
}

// ── 5. Release version consistency ──
console.log('\n[5] Version consistency');

const cargoPath = path.join(TAURI_DIR, 'Cargo.toml');
const cargoLockPath = path.join(TAURI_DIR, 'Cargo.lock');
const packagePath = path.join(DESKTOP_ROOT, 'package.json');
const packageLockPath = path.join(DESKTOP_ROOT, 'package-lock.json');
if (fs.existsSync(cargoPath) && fs.existsSync(cargoLockPath) && fs.existsSync(confPath) && fs.existsSync(packagePath) && fs.existsSync(packageLockPath)) {
  const cargoContent = fs.readFileSync(cargoPath, 'utf8');
  const cargoVersion = cargoContent.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
  const cargoLockVersion = cargoLock.match(/\[\[package\]\]\s+name = "ga-desktop"\s+version = "([^"]+)"/m)?.[1];
  const tauriConf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
  const versions = {
    'package.json': packageJson.version,
    'package-lock.json': packageLock.version,
    'package-lock root': packageLock.packages?.['']?.version,
    'Cargo.toml': cargoVersion,
    'Cargo.lock ga-desktop': cargoLockVersion,
    'tauri.conf.json': tauriConf.version,
  };
  for (const [source, version] of Object.entries(versions)) {
    if (version === RELEASE_VERSION) {
      ok(`${source} version is ${RELEASE_VERSION}`);
    } else {
      bad(`${source} version is ${version ?? 'missing'}; expected ${RELEASE_VERSION}`);
    }
  }
}

// ── Summary ──
console.log(`\n=== Results ===`);
console.log(`  PASS: ${pass}`);
console.log(`  FAIL: ${fail}`);
if (warnings.length) console.log(`  WARN: ${warnings.length}`);
console.log('');

process.exit(fail > 0 ? 1 : 0);
