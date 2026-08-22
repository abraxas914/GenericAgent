import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REMOVED_LEGACY_REACT_PUBLIC_ASSETS,
  REQUIRED_REACT_PUBLIC_ASSETS,
} from './react-public-assets.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');
const failures = [];

function readText(relativePath, base = desktopRoot) {
  return fs.readFileSync(path.join(base, relativePath), 'utf8');
}

function readJson(relativePath, base = desktopRoot) {
  return JSON.parse(readText(relativePath, base));
}

function check(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

function compareDependencySets(label, manifestValues = {}, lockValues = {}) {
  const manifestKeys = Object.keys(manifestValues).sort();
  const lockKeys = Object.keys(lockValues).sort();
  check(
    JSON.stringify(manifestKeys) === JSON.stringify(lockKeys),
    `${label} keys match package-lock.json`,
  );

  for (const name of manifestKeys) {
    check(
      manifestValues[name] === lockValues[name],
      `${label}.${name} version matches package-lock.json`,
    );
  }
}

console.log('[1] npm manifest and lockfile');
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const lockRoot = packageLock.packages?.[''];
check(Boolean(lockRoot), 'package-lock.json has a root package entry');
if (lockRoot) {
  check(packageJson.name === lockRoot.name, 'package name matches package-lock.json');
  check(packageJson.version === lockRoot.version, 'package version matches package-lock.json');
  compareDependencySets('dependencies', packageJson.dependencies, lockRoot.dependencies);
  compareDependencySets('devDependencies', packageJson.devDependencies, lockRoot.devDependencies);
}

const requiredScripts = [
  'build',
  'typecheck',
  'test',
  'test:ci-contract',
  'test:e2e-isolation',
  'test:e2e-types',
  'test:packaging',
  'e2e:browser',
  'e2e:desktop',
  'e2e:desktop:full',
  'e2e:canary',
  'tauri',
];
for (const name of requiredScripts) {
  check(Boolean(packageJson.scripts?.[name]), `npm script exists: ${name}`);
}

const gitignore = readText('.gitignore');
check(!/^package-lock\.json\s*$/m.test(gitignore), 'package-lock.json is not ignored');

console.log('\n[2] workflow command contract');
const workflowPaths = [
  '.github/workflows/desktop-ci.yml',
  '.github/workflows/desktop-release-package.yml',
];
for (const workflowPath of workflowPaths) {
  const workflow = readText(workflowPath, repoRoot);
  const referencedScripts = [...workflow.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map(
    (match) => match[1],
  );
  for (const name of new Set(referencedScripts)) {
    check(Boolean(packageJson.scripts?.[name]), `${workflowPath} references npm script: ${name}`);
  }
  check(
    !/\bnpx\s+(?:tsc|tsx|vite|vitest|wdio)\b/.test(workflow),
    `${workflowPath} does not use npx fallback for pinned tools`,
  );
}

const releaseWorkflow = readText('.github/workflows/desktop-release-package.yml', repoRoot);
function workflowJob(workflow, name) {
  const header = new RegExp(`^  ${name}:\\s*$`, 'm');
  const match = header.exec(workflow);
  if (!match) return '';
  const remainder = workflow.slice(match.index + match[0].length);
  const nextJob = /^  [a-zA-Z0-9_-]+:\s*$/m.exec(remainder);
  return nextJob ? remainder.slice(0, nextJob.index) : remainder;
}

const buildJobs = ['build-windows', 'build-linux', 'build-macos'];
const releaseJobsSection = releaseWorkflow.slice(releaseWorkflow.search(/^jobs:\s*$/m));
const releaseJobNames = [...releaseJobsSection.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map((match) => match[1]);
check(
  JSON.stringify(releaseJobNames) === JSON.stringify([...buildJobs, 'publish-release']),
  'release workflow contains only three builders and one publisher',
);
const buildJobWorkflows = Object.fromEntries(buildJobs.map((job) => [job, workflowJob(releaseWorkflow, job)]));
for (const job of buildJobs) {
  const workflow = buildJobWorkflows[job];
  check(Boolean(workflow), `release workflow keeps build job: ${job}`);
  check(
    /^    permissions:\n      contents: read\s*$/m.test(workflow)
      && !/^      [a-z-]+:\s+(?:write|read)\s*$/m.test(workflow.replace('      contents: read', '')),
    `${job} has only contents: read permission`,
  );
  check(
    /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n        with:\n          persist-credentials: false/.test(workflow),
    `${job} checkout does not persist credentials`,
  );
  check(
    !workflow.includes('secrets.GITHUB_TOKEN') && !/\bgh release\b/.test(workflow),
    `${job} neither receives a release token nor publishes`,
  );
  check(
    workflow.includes('npm ci') && !workflow.includes('npm install'),
    `${job} installs the locked npm graph with npm ci`,
  );
  check(
    workflow.includes("--exclude='./frontends/desktop/dist'")
      || workflow.includes("--exclude='frontends/desktop/dist'"),
    `${job} excludes the Tauri-embedded React dist from runtime/app`,
  );
  check(
    workflow.includes('test ! -e "$RUNTIME/app/frontends/desktop/dist"')
      || workflow.includes('test ! -e "$RUNTIME_SRC/app/frontends/desktop/dist"'),
    `${job} hard-fails if React dist re-enters runtime/app`,
  );
  check(
    workflow.includes('pip download --only-binary=:all:')
      && workflow.includes('packaging/python-runtime-requirements.txt'),
    `${job} downloads the exact binary-only runtime requirement set`,
  );
}

check(
  /^permissions:\n  contents: read\s*$/m.test(releaseWorkflow),
  'release workflow defaults to contents: read',
);

const pinnedActionRefs = new Set([
  'actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd',
  'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444',
  'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  'actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131',
  'dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c',
  'Swatinem/rust-cache@63fed3e2fecf6f7b51dc6f043341b79ef82a9ae7',
]);
const actionLines = releaseWorkflow.split('\n').filter((line) => /\buses:\s+/.test(line));
for (const line of actionLines) {
  const match = line.match(/uses:\s+([^\s#]+)(?:\s+#\s+(.+))?$/);
  check(
    Boolean(match && pinnedActionRefs.has(match[1]) && match[2]),
    `release action is a trusted full-SHA pin with a version/source comment: ${match?.[1] ?? line.trim()}`,
  );
}
for (const actionRef of pinnedActionRefs) {
  check(releaseWorkflow.includes(actionRef), `release workflow includes pinned action: ${actionRef}`);
}

check(
  releaseWorkflow.includes('NODE_VERSION: "22.23.2"')
    && releaseWorkflow.includes('RUST_TOOLCHAIN: "1.95.0"')
    && releaseWorkflow.includes('PBS_RELEASE: "20260814"')
    && releaseWorkflow.includes('PBS_PYTHON_VERSION: "3.12.14"')
    && !releaseWorkflow.includes('/releases/latest'),
  'Node, Rust, and python-build-standalone versions are exact and do not use releases/latest',
);
for (const digest of [
  '7330282b47cd43a66b702d39078d2e5a88e580cee351d82f95045f21f5ee042a',
  '3297691ae34f75fed81ac424e040145fccb0bafe8e581cd5cadbddfa1c0766c0',
  '4572133a5542f306b9bdb155da5800f9e38950cd0a98d469b832ce256fe299ea',
]) {
  check(releaseWorkflow.includes(digest), `release workflow pins PBS SHA-256: ${digest}`);
}

const runtimeRequirements = readText('packaging/python-runtime-requirements.txt');
const runtimeRequirementLines = runtimeRequirements
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
check(
  runtimeRequirementLines.length > 20
    && runtimeRequirementLines.every((line) => /^[a-z0-9][a-z0-9._-]*==[^\s]+$/i.test(line)),
  'runtime direct and transitive requirements use exact versions',
);
for (const dependency of [
  'requests',
  'beautifulsoup4',
  'bottle',
  'simple-websocket-server',
  'aiohttp',
  'psutil',
  'fastapi',
  'uvicorn',
  'websockets',
  'pydantic',
]) {
  check(
    runtimeRequirementLines.some((line) => line.startsWith(`${dependency}==`)),
    `runtime lock includes direct dependency: ${dependency}`,
  );
}
check(
  !runtimeRequirementLines.some((line) => /^(?:setuptools|wheel)==/i.test(line)),
  'binary-only recovery wheelhouse omits setuptools and wheel',
);

const dmgBuildRequirements = readText('packaging/dmg-build-requirements.txt');
check(
  dmgBuildRequirements.includes('ds-store==1.3.3')
    && dmgBuildRequirements.includes('mac-alias==2.2.3')
    && (dmgBuildRequirements.match(/--hash=sha256:[0-9a-f]{64}/g) ?? []).length === 2,
  'DMG layout build requirements are exact and hash-locked',
);

const publisherWorkflow = workflowJob(releaseWorkflow, 'publish-release');
check(Boolean(publisherWorkflow), 'release workflow has one publisher job');
check(
  publisherWorkflow.includes('needs: [build-windows, build-linux, build-macos]')
    && ['build-windows', 'build-linux', 'build-macos'].every((job) => publisherWorkflow.includes(`needs.${job}.result == 'success'`))
    && publisherWorkflow.includes("github.event_name == 'push'")
    && publisherWorkflow.includes("refs/tags/desktop-portable-"),
  'publisher requires all three successful tag builds and cannot run for workflow_dispatch',
);
check(
  /^    permissions:\n      contents: write\s*$/m.test(publisherWorkflow),
  'only the publisher receives contents: write',
);
check(
  (releaseWorkflow.match(/^      contents: write\s*$/gm) ?? []).length === 1,
  'release workflow grants contents: write exactly once',
);
check(
  !/\b(?:npm|pip|cargo|python3?)\b|actions\/checkout@|frontends\/desktop\/scripts\//.test(publisherWorkflow),
  'publisher does not check out source or run package/build tooling',
);
check(
  (publisherWorkflow.match(/actions\/download-artifact@/g) ?? []).length === 3,
  'publisher downloads exactly three platform artifacts',
);
const expectedReleaseFiles = [
  'GenericAgent-Desktop-Windows-Portable.zip',
  'SHA256SUMS-windows.txt',
  'GenericAgent-Desktop-Linux-Portable.tar.gz',
  'SHA256SUMS-linux.txt',
  'GenericAgent-Desktop-macOS-aarch64.dmg',
  'GenericAgent-Desktop-macOS-aarch64.dmg.sha256',
];
for (const filename of expectedReleaseFiles) {
  check(publisherWorkflow.includes(filename), `publisher expects release file: ${filename}`);
}
check(
  publisherWorkflow.includes('Release staging must contain exactly the six expected files')
    && (publisherWorkflow.match(/verify_checksum_manifest /g) ?? []).length === 3,
  'publisher strictly checks the six-file set and all three payload checksums',
);
check(
  (publisherWorkflow.match(/\bgh release create\b/g) ?? []).length === 1
    && !publisherWorkflow.includes('gh release upload')
    && publisherWorkflow.includes('--draft')
    && publisherWorkflow.includes('gh release edit "$TAG_NAME" --draft=false --prerelease'),
  'publisher creates one draft with all assets, verifies it, then atomically exposes the prerelease',
);

const macJobWorkflow = buildJobWorkflows['build-macos'];
const postDmgScript = readText('scripts/post-dmg.sh');
const macInstallScript = readText('packaging/scripts/macos/install_macos.sh');
check(
  macJobWorkflow.includes('runs-on: macos-15')
    && macJobWorkflow.includes('test "$(uname -m)" = arm64')
    && macJobWorkflow.includes('aarch64-apple-darwin-install_only.tar.gz')
    && !macJobWorkflow.includes('x86_64-apple-darwin'),
  'macOS packaging uses the explicit arm64 runner and runtime with an architecture assertion',
);
check(
  /pip install --require-hashes --only-binary=:all:\s+--requirement frontends\/desktop\/packaging\/dmg-build-requirements\.txt/.test(macJobWorkflow),
  'macOS packaging hash-locks the DMG layout dependency',
);
check(
  macJobWorkflow.includes('pip install --no-compile --no-index --find-links "$RUNTIME_SRC/wheels"')
    && macJobWorkflow.includes('pip uninstall --yes setuptools wheel')
    && macJobWorkflow.includes("-name '__pycache__' -empty -delete"),
  'macOS packaging omits installed build tools and bytecode caches',
);
check(
  !macJobWorkflow.includes('fastapi uvicorn websockets pydantic setuptools wheel')
    && macJobWorkflow.includes('(\"setuptools\", \"wheel\", \"pkg_resources\")'),
  'macOS packaging removes build tools from both the recovery wheelhouse and installed runtime',
);
check(
  macJobWorkflow.includes('DMG_SITE_PACKAGES="$DMG_APP/Contents/Resources/runtime/python/lib/python3.12/site-packages"')
    && macJobWorkflow.includes('PYTHONDONTWRITEBYTECODE=1 "$DMG_APP/Contents/Resources/runtime/python/bin/python3"')
    && macJobWorkflow.includes('find "$DMG_SITE_PACKAGES" -type d -name \'__pycache__\'')
    && macJobWorkflow.includes('find "$DMG_SITE_PACKAGES" -type f'),
  'macOS packaging verifies the final DMG app remains bytecode-cache free',
);
check(
  macInstallScript.includes('export PYTHONDONTWRITEBYTECODE=1')
    && macInstallScript.includes('pip install --no-compile --no-index --find-links "$WHEEL_DIR"')
    && macInstallScript.includes('--requirement "$locked_requirements"')
    && macInstallScript.includes('pip install --upgrade pip setuptools wheel'),
  'macOS offline repair consumes the exact lock while online source repair keeps build tools separate',
);
check(
  /bash frontends\/desktop\/scripts\/post-dmg\.sh "artifacts\/macos\/out\/GenericAgent-Desktop-macOS-aarch64\.dmg"/.test(macJobWorkflow),
  'macOS packaging applies the curated Finder layout',
);
check(
  !macJobWorkflow.includes('PORTABLE=')
    && (macJobWorkflow.match(/codesign --force --deep --sign -/g) ?? []).length === 1
    && (macJobWorkflow.match(/codesign --verify --deep --strict/g) ?? []).length === 1
    && !/codesign --verify[^\n]*\|\| true/.test(macJobWorkflow)
    && macJobWorkflow.includes('Ad-hoc signing only'),
  'macOS builds only the uploaded DMG and hard-fails ad-hoc signature verification',
);
check(
  publisherWorkflow.includes('neither Developer ID signed nor notarized'),
  'release notes accurately disclose the macOS signing and notarization status',
);
check(
  postDmgScript.includes('Only contains .app + Applications symlink + .DS_Store'),
  'DMG post-processing keeps the curated two-item volume',
);
check(
  postDmgScript.includes("'WindowBounds': '{{100, 100}, {540, 380}}'")
    && postDmgScript.includes("struct.pack('>II', 140, 190)")
    && postDmgScript.includes("struct.pack('>II', 400, 190)"),
  'DMG post-processing preserves the established window and icon positions',
);
check(
  !/\b(?:aiortc|cryptography)\b/.test(releaseWorkflow),
  'portable packages do not add optional heavy P2P dependencies',
);
check(
  !fs.existsSync(path.join(repoRoot, '.github/workflows/desktop-e2e-nightly.yml')),
  'fork-only nightly workflow is absent',
);

console.log('\n[3] Tauri and native E2E contract');
const cargoToml = readText('src-tauri/Cargo.toml');
check(/^\[features\]$/m.test(cargoToml), 'Cargo.toml declares a features section');
check(/^e2e\s*=\s*\[/m.test(cargoToml), 'Cargo.toml declares the e2e feature');
check(cargoToml.includes('tauri-plugin-wdio'), 'Cargo.toml declares WDIO plugins');

const requiredFiles = [
  'e2e/run.ts',
  'e2e/wdio.browser.conf.ts',
  'e2e/wdio.desktop.conf.ts',
  'e2e/package/real_package_journey.py',
  'e2e/package/verify_candidate_evidence.py',
  'e2e/windows/Invoke-WindowsUserJourney.ps1',
  'e2e/linux/Invoke-LinuxUserJourney.sh',
  'e2e/macos/Invoke-macOSUserJourney.sh',
  'src-tauri/tauri.e2e.conf.json',
  'tsconfig.e2e.json',
];
for (const relativePath of requiredFiles) {
  check(fs.existsSync(path.join(desktopRoot, relativePath)), `required E2E file exists: ${relativePath}`);
}

const tauriConfig = readJson('src-tauri/tauri.conf.json');
check(tauriConfig.build?.frontendDist === '../dist', 'Tauri packages the React dist directory');
check(tauriConfig.build?.beforeBuildCommand === 'npm run build', 'Tauri runs the frontend build first');
check(
  tauriConfig.app?.security?.capabilities?.includes('default'),
  'Tauri explicitly enables the default capability',
);

console.log('\n[4] bootstrap and window capability contract');
for (const publicAsset of REQUIRED_REACT_PUBLIC_ASSETS) {
  const relativePath = `public/${publicAsset}`;
  const absolutePath = path.join(desktopRoot, relativePath);
  check(fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0, `${relativePath} is present`);
}
for (const publicAsset of REMOVED_LEGACY_REACT_PUBLIC_ASSETS) {
  const relativePath = `public/${publicAsset}`;
  check(!fs.existsSync(path.join(desktopRoot, relativePath)), `${relativePath} stays removed from React v2`);
}

const capability = readJson('src-tauri/capabilities/default.json');
const permissions = new Set(capability.permissions ?? []);
for (const permission of [
  'core:window:allow-minimize',
  'core:window:allow-toggle-maximize',
  'core:window:allow-close',
  'core:window:allow-start-dragging',
  'allow-retry-bootstrap',
  'allow-get-bootstrap-snapshot',
]) {
  check(permissions.has(permission), `capability grants: ${permission}`);
}

console.log('\n=== CI contract result ===');
if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} contract violation(s)`);
  process.exitCode = 1;
} else {
  console.log('PASS: desktop CI inputs are internally consistent');
}
