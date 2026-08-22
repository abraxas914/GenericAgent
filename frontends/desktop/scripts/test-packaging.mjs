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
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');
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
  if (content.includes('requirements.txt') && content.includes('--requirement')) {
    ok(`offline installer consumes packaged requirements lock: ${relative}`);
  } else {
    bad(`offline installer bypasses packaged requirements lock: ${relative}`);
  }
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
