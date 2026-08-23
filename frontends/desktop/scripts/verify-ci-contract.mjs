import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REMOVED_LEGACY_REACT_PUBLIC_ASSETS,
  REQUIRED_REACT_PUBLIC_ASSET_SHA256,
  REQUIRED_REACT_PUBLIC_ASSETS,
  SEMI_UI_NOTICE_CONTRACT,
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

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Bytes(contents) {
  return createHash('sha256').update(contents).digest('hex');
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
const tauriConfig = readJson('src-tauri/tauri.conf.json');
const lockRoot = packageLock.packages?.[''];
check(Boolean(lockRoot), 'package-lock.json has a root package entry');
if (lockRoot) {
  check(packageJson.name === lockRoot.name, 'package name matches package-lock.json');
  check(packageJson.version === lockRoot.version, 'package version matches package-lock.json');
  compareDependencySets('dependencies', packageJson.dependencies, lockRoot.dependencies);
  compareDependencySets('devDependencies', packageJson.devDependencies, lockRoot.devDependencies);
}
const semiUiLock = packageLock.packages?.[`node_modules/${SEMI_UI_NOTICE_CONTRACT.packageName}`];
check(
  semiUiLock?.version === SEMI_UI_NOTICE_CONTRACT.packageVersion,
  `${SEMI_UI_NOTICE_CONTRACT.packageName} notice version matches package-lock.json`,
);
const tauriCliVersion = '2.11.4';
check(
  packageJson.devDependencies?.['@tauri-apps/cli'] === tauriCliVersion
    && lockRoot?.devDependencies?.['@tauri-apps/cli'] === tauriCliVersion
    && packageLock.packages?.['node_modules/@tauri-apps/cli']?.version === tauriCliVersion,
  `@tauri-apps/cli is exactly pinned to ${tauriCliVersion} in the manifest and lockfile`,
);

const requiredScripts = [
  'build',
  'build:tauri-assets',
  'typecheck',
  'test',
  'test:bundle',
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

const noticeAttributeRules = [
  'frontends/desktop/public/THIRD_PARTY_NOTICES.txt text eol=lf',
  'frontends/desktop/dist/THIRD_PARTY_NOTICES.txt text eol=lf',
];
function noticeAttributesAreExact(attributes) {
  const lines = attributes.split(/\r?\n/);
  return noticeAttributeRules.every((rule) => {
    const noticePath = rule.split(' ', 1)[0];
    const matchingRules = lines.filter((line) => line.trim().split(/\s+/, 1)[0] === noticePath);
    return matchingRules.length === 1 && matchingRules[0] === rule;
  });
}

const gitAttributes = readText('.gitattributes', repoRoot);
check(
  noticeAttributesAreExact(gitAttributes),
  'source and compiled third-party notices each have one exact LF attribute rule',
);
for (const rule of noticeAttributeRules) {
  check(
    !noticeAttributesAreExact(gitAttributes.replace(`${rule}\n`, '')),
    `notice attribute contract rejects deleting: ${rule}`,
  );
}
check(
  !noticeAttributesAreExact(
    gitAttributes.replace(
      noticeAttributeRules[0],
      noticeAttributeRules[0].replace('eol=lf', 'eol=crlf'),
    ),
  ),
  'notice attribute contract rejects CRLF checkout normalization',
);

const noticePath = path.join(desktopRoot, 'public', SEMI_UI_NOTICE_CONTRACT.publicAsset);
const noticeBytes = fs.readFileSync(noticePath);
const crlfNoticeBytes = Buffer.from(
  noticeBytes.toString('utf8').replace(/\r?\n/g, '\r\n'),
  'utf8',
);
check(
  sha256Bytes(noticeBytes) === SEMI_UI_NOTICE_CONTRACT.sha256,
  'source third-party notice has the required byte-exact SHA-256',
);
check(
  sha256Bytes(crlfNoticeBytes) !== SEMI_UI_NOTICE_CONTRACT.sha256,
  'notice hash contract rejects CRLF-mutated bytes',
);

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

const noticeGatedTauriCommands = Object.freeze({
  'build-windows': 'npm run tauri build -- --bundles nsis',
  'build-linux': 'npm run tauri build -- --bundles appimage',
  'build-macos': 'npm run tauri build -- --bundles app',
});
const distIntegrityScript = readText('scripts/assert-dist-built.mjs');

function noticePreEmbedGateIsExact(
  scripts = packageJson.scripts,
  config = tauriConfig,
  contractScript = distIntegrityScript,
) {
  return scripts?.['test:bundle'] === 'node scripts/assert-dist-built.mjs'
    && scripts?.['build:tauri-assets'] === 'npm run build && npm run test:bundle'
    && config?.build?.beforeBuildCommand === 'npm run build:tauri-assets'
    && contractScript.includes('REQUIRED_REACT_PUBLIC_ASSET_SHA256')
    && contractScript.includes('sha256(builtPath) !== expectedHash')
    && contractScript.includes('in dist/ does not match its required SHA-256');
}

function releaseJobUsesNoticeGatedTauriBuild(workflow, job) {
  const command = noticeGatedTauriCommands[job];
  const jobWorkflow = workflowJob(workflow, job);
  return Boolean(command)
    && noticePreEmbedGateIsExact()
    && (jobWorkflow.split(`run: ${command}`).length - 1) === 1;
}

function macosPackagingPythonInputsAreSeparated(workflow) {
  const macJob = workflowJob(workflow, 'build-macos');
  return (workflow.match(/^  MACOS_PACKAGING_PYTHON_VERSION: "3\.12\.10"$/gm) ?? []).length === 1
    && (workflow.match(/^  PBS_PYTHON_VERSION: "3\.12\.14"$/gm) ?? []).length === 1
    && (workflow.match(/\$\{\{ env\.MACOS_PACKAGING_PYTHON_VERSION \}\}/g) ?? []).length === 1
    && /uses: actions\/setup-python@[0-9a-f]{40}[^\n]*\n        with:\n          python-version: \$\{\{ env\.MACOS_PACKAGING_PYTHON_VERSION \}\}/.test(macJob)
    && !/python-version: \$\{\{ env\.PBS_PYTHON_VERSION \}\}/.test(macJob)
    && (workflow.match(/cpython-\$\{PBS_PYTHON_VERSION\}%2B\$\{PBS_RELEASE\}-/g) ?? []).length === 3
    && macJob.includes('cpython-${PBS_PYTHON_VERSION}%2B${PBS_RELEASE}-aarch64-apple-darwin-install_only.tar.gz')
    && !macJob.includes('cpython-${MACOS_PACKAGING_PYTHON_VERSION}');
}

function windowsPbsArchiveUsesPosixTempPath(workflow) {
  const windowsJob = workflowJob(workflow, 'build-windows');
  return (windowsJob.match(/command -v cygpath >\/dev\/null 2>&1/g) ?? []).length === 1
    && (windowsJob.match(/RUNNER_TEMP_POSIX="\$\(cygpath -u "\$RUNNER_TEMP"\)"/g) ?? []).length === 1
    && (windowsJob.match(/\[\[ "\$RUNNER_TEMP_POSIX" == \/\* \]\]/g) ?? []).length === 1
    && (windowsJob.match(/PBS_ARCHIVE="\$\{RUNNER_TEMP_POSIX\}\/pbs-windows-x86_64\.tar\.gz"/g) ?? []).length === 1
    && !windowsJob.includes('PBS_ARCHIVE="${RUNNER_TEMP}/pbs-windows-x86_64.tar.gz"');
}

function wholeRuntimeBytecodeContract(workflow) {
  const specs = [
    ['build-windows', ['purge_runtime_bytecode "$RUNTIME"']],
    ['build-linux', ['purge_runtime_bytecode "$RUNTIME"']],
    ['build-macos', [
      'purge_runtime_bytecode "$RUNTIME_SRC"',
      'purge_runtime_bytecode "$DMG_RUNTIME"',
    ]],
  ];
  return (workflow.match(/^  PYTHONDONTWRITEBYTECODE: "1"$/gm) ?? []).length === 1
    && specs.every(([jobName, requiredCalls]) => {
      const job = workflowJob(workflow, jobName);
      return job.includes('purge_runtime_bytecode() {')
        && job.includes('find "$runtime_root" -type d -name \'__pycache__\'')
        && job.includes('find "$runtime_root" -type f \\( -name \'*.pyc\' -o -name \'*.pyo\' \\) -delete')
        && requiredCalls.every((call) => job.includes(call))
        && !/pip[\\/]_vendor/.test(job);
    });
}

function settingsMergeContract(storage, helper, installers, workflow) {
  const fixedUpdates = [
    '"python_path": python_path',
    '"project_dir": project_dir',
    '"bridge_script": bridge_script',
  ];
  return fixedUpdates.every((line) => storage.includes(line))
    && helper.includes('from desktop_settings import merge_package_paths, remove_bundle_paths')
    && storage.includes('document = read_settings(settings_path, strict=True)')
    && storage.includes('with settings_lock(settings_path):')
    && storage.includes('os.replace(temporary, settings_path)')
    && storage.includes('os.fsync(stream.fileno())')
    && !storage.includes('document.clear(')
    && installers.every((script) => script.includes('merge_desktop_settings.py'))
    && (workflow.match(/cp frontends\/desktop\/packaging\/scripts\/merge_desktop_settings\.py/g) ?? []).length === 3;
}

function linuxPortabilityContract(workflow) {
  const linuxJob = workflowJob(workflow, 'build-linux');
  return linuxJob.includes('runs-on: ubuntu-22.04')
    && !linuxJob.includes('runs-on: ubuntu-24.04')
    && linuxJob.includes('"$APPIMAGE_ABS" --appimage-extract')
    && linuxJob.includes('find "$SMOKE_PACKAGE" "$APPIMAGE_SCAN/squashfs-root" -type f -print0')
    && linuxJob.includes("file -b \"$candidate\" | grep -q '^ELF'")
    && linuxJob.includes('readelf --version-info "$candidate"')
    && linuxJob.includes('maximum allowed is GLIBC_2.35')
    && linuxJob.includes('"$MAX_GLIBC" \'2.35\'')
    && linuxJob.includes('APPIMAGE_EXTRACT_AND_RUN=1')
    && linuxJob.includes('xvfb-run -a "$SMOKE_PACKAGE/GenericAgent.AppImage"')
    && linuxJob.includes('http://127.0.0.1:14168/services/identity')
    && linuxJob.includes('actual == expected');
}

function linuxReleaseRustCacheContract(workflow) {
  const linuxJob = workflowJob(workflow, 'build-linux');
  return linuxJob.includes('runs-on: ubuntu-22.04')
    && linuxJob.includes('prefix-key: "v1-rust-release-ubuntu-22.04-glibc-2.35"')
    && !linuxJob.includes('prefix-key: "v0-rust"')
    && linuxJob.includes('cache-targets: "false"')
    && linuxJob.includes('cache-bin: "false"');
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
    workflow.includes("node -e \"const v=require('./node_modules/@tauri-apps/cli/package.json').version; if(v!=='2.11.4')"),
    `${job} asserts the exact Tauri CLI version after installation`,
  );
  check(
    prunedRuntimeSourceContract(workflow),
    `${job} excludes development/frontend source while retaining Desktop v1 static assets`,
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
  check(
    releaseJobUsesNoticeGatedTauriBuild(releaseWorkflow, job),
    `${job} validates the generated notice hash immediately before Tauri embeds dist`,
  );
  const tauriCommand = noticeGatedTauriCommands[job];
  check(
    !releaseJobUsesNoticeGatedTauriBuild(
      releaseWorkflow.replace(`        run: ${tauriCommand}\n`, '        run: npm run build\n'),
      job,
    ),
    `${job} notice gate contract rejects deleting its Tauri pre-embed check`,
  );
}

check(
  wholeRuntimeBytecodeContract(releaseWorkflow),
  'all package builders suppress and purge bytecode across each complete runtime',
);
check(linuxPortabilityContract(releaseWorkflow), 'Linux package is built and smoke-tested at the glibc 2.35 floor');
for (const [label, mutation] of [
  ['Ubuntu 22.04 builder', releaseWorkflow.replace('runs-on: ubuntu-22.04', 'runs-on: ubuntu-24.04')],
  ['glibc 2.35 ceiling', releaseWorkflow.replace('maximum allowed is GLIBC_2.35', 'maximum allowed is GLIBC_2.39')],
  ['all-ELF traversal', releaseWorkflow.replace('"$APPIMAGE_SCAN/squashfs-root" -type f -print0', '-type f -print0')],
  ['archived package identity smoke', releaseWorkflow.replace('actual == expected', 'actual != expected')],
]) {
  check(!linuxPortabilityContract(mutation), `Linux portability contract rejects deleting ${label}`);
}
check(
  linuxReleaseRustCacheContract(releaseWorkflow),
  'Linux release cache uses a fresh glibc 2.35 namespace without target or Cargo bin artifacts',
);
for (const [label, mutation] of [
  [
    'the Ubuntu 22.04 and glibc 2.35 cache namespace',
    releaseWorkflow.replace(
      'prefix-key: "v1-rust-release-ubuntu-22.04-glibc-2.35"',
      'prefix-key: "v0-rust"',
    ),
  ],
  [
    'target artifact isolation',
    releaseWorkflow.replace('cache-targets: "false"', 'cache-targets: "true"'),
  ],
  ['Cargo bin isolation', releaseWorkflow.replace('cache-bin: "false"', 'cache-bin: "true"')],
]) {
  check(
    !linuxReleaseRustCacheContract(mutation),
    `Linux release cache contract rejects deleting ${label}`,
  );
}
for (const [label, mutation] of [
  ['the no-bytecode environment', releaseWorkflow.replace('  PYTHONDONTWRITEBYTECODE: "1"\n', '')],
  ['whole-runtime cleanup', releaseWorkflow.replace(
    'purge_runtime_bytecode "$RUNTIME"',
    'purge_runtime_bytecode "$RUNTIME/python/lib/python3.12/site-packages"',
  )],
  ['pyo cleanup', releaseWorkflow.replace(" -o -name '*.pyo'", '')],
]) {
  check(
    !wholeRuntimeBytecodeContract(mutation),
    `runtime bytecode contract rejects deleting ${label}`,
  );
}

check(
  noticePreEmbedGateIsExact(),
  'Tauri frontend build runs the cross-platform dist hash contract before embedding',
);
check(
  !noticePreEmbedGateIsExact({
    ...packageJson.scripts,
    'build:tauri-assets': 'npm run build',
  }),
  'Tauri pre-embed contract rejects removing the bundle integrity check',
);

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
    && releaseWorkflow.includes('MACOS_PACKAGING_PYTHON_VERSION: "3.12.10"')
    && !releaseWorkflow.includes('/releases/latest'),
  'Node, Rust, host packaging Python, and python-build-standalone versions are exact and do not use releases/latest',
);
check(
  macosPackagingPythonInputsAreSeparated(releaseWorkflow),
  'macOS host packaging Python is exact and separate from the embedded PBS runtime',
);
check(
  !macosPackagingPythonInputsAreSeparated(
    releaseWorkflow.replace(
      '${{ env.MACOS_PACKAGING_PYTHON_VERSION }}',
      '${{ env.PBS_PYTHON_VERSION }}',
    ),
  ),
  'macOS Python contract rejects coupling setup-python to the PBS runtime version',
);
check(
  !macosPackagingPythonInputsAreSeparated(
    releaseWorkflow.replace(
      'MACOS_PACKAGING_PYTHON_VERSION: "3.12.10"',
      'MACOS_PACKAGING_PYTHON_VERSION: "3.12"',
    ),
  ),
  'macOS Python contract rejects a floating host packaging version',
);
check(
  windowsPbsArchiveUsesPosixTempPath(releaseWorkflow),
  'Windows PBS archive uses an asserted absolute POSIX runner temp path',
);
check(
  !windowsPbsArchiveUsesPosixTempPath(
    releaseWorkflow.replace(
      'PBS_ARCHIVE="${RUNNER_TEMP_POSIX}/pbs-windows-x86_64.tar.gz"',
      'PBS_ARCHIVE="${RUNNER_TEMP}/pbs-windows-x86_64.tar.gz"',
    ),
  ),
  'Windows PBS archive contract rejects a raw drive-letter runner temp path',
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
const publisherRun = publisherWorkflow.slice(publisherWorkflow.indexOf('        run: |'));
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
  publisherWorkflow.includes('TAG_NAME: ${{ github.ref_name }}')
    && publisherWorkflow.includes('TARGET_SHA: ${{ github.sha }}')
    && !publisherRun.includes('${{ github.ref_name }}')
    && !publisherRun.includes('${{ github.sha }}')
    && publisherRun.includes('^desktop-portable-[A-Za-z0-9._-]+$')
    && publisherRun.includes('^[0-9a-f]{40}$')
    && publisherRun.includes('--target "$TARGET_SHA"'),
  'publisher passes ref data through env and fail-closed tag/SHA validation',
);
check(
  !/^desktop-portable-[A-Za-z0-9._-]+$/.test('desktop-portable-$(touch injected)')
    && !/^desktop-portable-[A-Za-z0-9._-]+$/.test('desktop-portable-`touch injected`'),
  'publisher tag validator rejects command-substitution payloads',
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
const linuxInstallScript = readText('packaging/scripts/linux/install_linux.sh');
const windowsInstallScript = readText('packaging/scripts/windows/install_windows.ps1');
const settingsMergeHelper = readText('packaging/scripts/merge_desktop_settings.py');
const settingsStorage = readText('../desktop_settings.py');
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
    && macJobWorkflow.includes('purge_runtime_bytecode "$RUNTIME_SRC"'),
  'macOS packaging omits installed build tools and purges the prepared runtime',
);
check(
  !macJobWorkflow.includes('fastapi uvicorn websockets pydantic setuptools wheel')
    && macJobWorkflow.includes('(\"setuptools\", \"wheel\", \"pkg_resources\")'),
  'macOS packaging removes build tools from both the recovery wheelhouse and installed runtime',
);
check(
  macJobWorkflow.includes('DMG_RUNTIME="$DMG_APP/Contents/Resources/runtime"')
    && macJobWorkflow.includes('PYTHONDONTWRITEBYTECODE=1 "$DMG_RUNTIME/python/bin/python3"')
    && macJobWorkflow.includes('purge_runtime_bytecode "$DMG_RUNTIME"'),
  'macOS packaging verifies the final DMG app remains bytecode-cache free',
);
check(
  macInstallScript.includes('export PYTHONDONTWRITEBYTECODE=1')
    && macInstallScript.includes('pip install --no-compile --no-index --find-links "$WHEEL_DIR"')
    && macInstallScript.includes('--requirement "$locked_requirements"')
    && macInstallScript.includes('pip install --no-compile --upgrade pip setuptools wheel'),
  'macOS offline repair consumes the exact lock while online source repair keeps build tools separate',
);
check(
  settingsMergeContract(
    settingsStorage,
    settingsMergeHelper,
    [windowsInstallScript, linuxInstallScript, macInstallScript],
    releaseWorkflow,
  ),
  'all installers use the bundled atomic read-modify-merge settings helper',
);
check(
  !settingsMergeContract(
    settingsStorage.replace('os.replace(temporary, settings_path)', 'settings_path.write_bytes(payload)'),
    settingsMergeHelper,
    [windowsInstallScript, linuxInstallScript, macInstallScript],
    releaseWorkflow,
  ),
  'settings merge contract rejects removing atomic replacement',
);
for (const [label, script] of [
  ['Windows', windowsInstallScript],
  ['Linux', linuxInstallScript],
  ['macOS', macInstallScript],
]) {
  check(!/pip[\\/]_vendor/.test(script), `${label} runtime cleanup preserves pip vendored sources`);
}
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
  publisherWorkflow.includes('Windows portable build is not code-signed')
    && publisherWorkflow.includes('SmartScreen may warn')
    && publisherWorkflow.includes('SHA256SUMS-windows.txt'),
  'release notes disclose the unsigned Windows build and checksum guidance',
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

const realPackageJourney = readText('e2e/package/real_package_journey.py');
const desktopBridge = readText('../desktop_bridge.py');
const conductorSource = readText('../conductor.py');
function nativePackageVersionContract(source) {
  return source.includes('plistlib.load(stream)')
    && source.includes('"CFBundleShortVersionString": info.get("CFBundleShortVersionString")')
    && source.includes('"CFBundleVersion": info.get("CFBundleVersion")')
    && source.includes('not isinstance(value, str) or value != RELEASE_VERSION')
    && source.includes('runtime contains excluded Desktop source metadata')
    && !source.includes('package_json = read_json(')
    && !source.includes('packaged package.json version');
}
check(
  nativePackageVersionContract(realPackageJourney),
  'real-package journey validates both native macOS version keys and rejects source package metadata',
);
for (const [label, mutation] of [
  ['CFBundleShortVersionString validation', realPackageJourney.replace(
    '"CFBundleShortVersionString": info.get("CFBundleShortVersionString"),',
    '"IgnoredShortVersion": info.get("CFBundleShortVersionString"),',
  )],
  ['CFBundleVersion validation', realPackageJourney.replace(
    '"CFBundleVersion": info.get("CFBundleVersion"),',
    '"IgnoredBundleVersion": info.get("CFBundleVersion"),',
  )],
  ['strict string version equality', realPackageJourney.replace(
    'not isinstance(value, str) or value != RELEASE_VERSION',
    'str(value) != RELEASE_VERSION',
  )],
  ['source package metadata rejection', realPackageJourney.replace(
    'runtime contains excluded Desktop source metadata',
    'runtime source metadata is ignored',
  )],
]) {
  check(!nativePackageVersionContract(mutation), `native package version contract rejects deleting ${label}`);
}

function managedServiceOwnershipContract(bridgeSource) {
  return bridgeSource.includes('owned = proc is not None and proc.poll() is None')
    && bridgeSource.includes('        running = owned\n')
    && bridgeSource.includes('"owned": owned')
    && bridgeSource.includes('"external": external')
    && bridgeSource.includes('"portConflict": external')
    && bridgeSource.includes('if self._state(sid).get("owned") is True')
    && bridgeSource.includes('if catalog_port and _port_alive(catalog_port):')
    && bridgeSource.includes('return {"ok": False, "error": "port_conflict", "service": item}')
    && bridgeSource.includes('return {"ok": False, "error": "not_owned", "service": item}')
    && bridgeSource.includes('proc.wait(timeout=5.0)')
    && bridgeSource.includes('proc.wait(timeout=2.0)');
}
check(
  managedServiceOwnershipContract(desktopBridge),
  'managed service state and lifecycle are based only on the bridge-owned child process',
);
for (const [label, mutation] of [
  ['owned running predicate', desktopBridge.replace('running = owned', 'running = owned or external')],
  ['maintenance owned-process predicate', desktopBridge.replace(
    'if self._state(sid).get("owned") is True',
    'if self._state(sid).get("running")',
  )],
  ['external-listener identity', desktopBridge.replace('"external": external', '"external": False')],
  ['pre-spawn port-conflict refusal', desktopBridge.replace(
    'if catalog_port and _port_alive(catalog_port):',
    'if False:',
  )],
  ['unowned stop refusal', desktopBridge.replace(
    'return {"ok": False, "error": "not_owned", "service": item}',
    'return {"ok": True, "service": item}',
  )],
  ['bounded graceful stop', desktopBridge.replace('proc.wait(timeout=5.0)', 'proc.wait()')],
]) {
  check(
    !managedServiceOwnershipContract(mutation),
    `managed service ownership contract rejects deleting ${label}`,
  );
}

function isolatedConductorPortContract(bridgeSource, conductor, journeySource) {
  return bridgeSource.includes('E2E_CONDUCTOR_PORT_ENV = "GA_DESKTOP_E2E_CONDUCTOR_PORT"')
    && bridgeSource.includes('if not os.environ.get(E2E_REPORT_DIR_ENV):')
    && bridgeSource.includes('"--port",')
    && bridgeSource.includes('str(conductor_port),')
    && bridgeSource.includes('"port": conductor_port')
    && conductor.includes('E2E_CONDUCTOR_PORT_ENV = "GA_DESKTOP_E2E_CONDUCTOR_PORT"')
    && conductor.includes('if not os.environ.get(E2E_REPORT_DIR_ENV):')
    && conductor.includes('parser.add_argument("--port", type=_parse_conductor_port, default=PORT)')
    && conductor.includes('PORT = args.port')
    && journeySource.includes('env[E2E_CONDUCTOR_PORT_ENV] = str(self.conductor_port)')
    && journeySource.includes('{BRIDGE_PORT, DEFAULT_BRIDGE_PORT, DEFAULT_CONDUCTOR_PORT}')
    && journeySource.includes('state.get("owned") is not True')
    && journeySource.includes('state.get("external") is not False')
    && journeySource.includes('state.get("port") != expected_port')
    && journeySource.includes('port_is_listening is not True')
    && journeySource.includes('not loopback_port_is_free(self.conductor_port)')
    && journeySource.includes('self.report["pids"][-1]["conductor"] = conductor["pid"]')
    && journeySource.includes('self.report["checks"]["finalConductorPortFree"] = loopback_port_is_free(')
    && journeySource.includes('"defaultConductorPortPreserved"');
}
check(
  isolatedConductorPortContract(desktopBridge, conductorSource, realPackageJourney),
  'real-package evidence uses one E2E-scoped conductor port and proves exact child ownership',
);
for (const [label, bridgeMutation = desktopBridge, conductorMutation = conductorSource, journeyMutation = realPackageJourney] of [
  ['bridge E2E scope', desktopBridge.replace(
    'if not os.environ.get(E2E_REPORT_DIR_ENV):',
    'if False:',
  )],
  ['bridge explicit child port', desktopBridge.replace('str(conductor_port),', '"8900",')],
  ['conductor E2E scope', desktopBridge, conductorSource.replace(
    'if not os.environ.get(E2E_REPORT_DIR_ENV):',
    'if False:',
  )],
  ['conductor effective global port', desktopBridge, conductorSource.replace('PORT = args.port', 'PORT = DEFAULT_PORT')],
  ['journey port injection', desktopBridge, conductorSource, realPackageJourney.replace(
    'env[E2E_CONDUCTOR_PORT_ENV] = str(self.conductor_port)',
    'env[E2E_CONDUCTOR_PORT_ENV] = "8900"',
  )],
  ['journey default bridge-port exclusion', desktopBridge, conductorSource, realPackageJourney.replace(
    '{BRIDGE_PORT, DEFAULT_BRIDGE_PORT, DEFAULT_CONDUCTOR_PORT}',
    '{BRIDGE_PORT, DEFAULT_CONDUCTOR_PORT}',
  )],
  ['journey owned-child assertion', desktopBridge, conductorSource, realPackageJourney.replace(
    'state.get("owned") is not True',
    'False',
  )],
  ['journey actual-listener assertion', desktopBridge, conductorSource, realPackageJourney.replace(
    'port_is_listening is not True',
    'False',
  )],
  ['journey isolated-port cleanup', desktopBridge, conductorSource, realPackageJourney.replace(
    'self.report["checks"]["finalConductorPortFree"] = loopback_port_is_free(',
    'self.report["checks"]["ignoredConductorPortFree"] = loopback_port_is_free(',
  )],
]) {
  check(
    !isolatedConductorPortContract(bridgeMutation, conductorMutation, journeyMutation),
    `isolated conductor port contract rejects deleting ${label}`,
  );
}

function packageImportIdleBarrierContract(journeySource, bridgeSource) {
  const conflictIndex = journeySource.indexOf('conflict_status, conflict_payload = request_json_with_status(');
  const stopIndex = journeySource.indexOf('"/services/stop-extras"');
  const panelIndex = journeySource.indexOf('verified_stopped_extras_panel(panel, running_extras)');
  const successIndex = journeySource.indexOf('result = request_json("POST", "/memory/import"');
  return bridgeSource.includes('"hasUnfinishedWork": self._session_has_unfinished_work(sess)')
    && journeySource.includes('snapshot.get("hasUnfinishedWork") is not False')
    && journeySource.includes('status != "idle"')
    && journeySource.includes('status in {"error", "cancelled"}')
    && journeySource.includes('payload.get("ok") is not False')
    && journeySource.includes('payload.get("runningSessions") != []')
    && journeySource.includes('CONDUCTOR_SERVICE_ID not in running_extras')
    && journeySource.includes('if import_target_snapshot() != before_conflict')
    && journeySource.includes('state.get("running") is not False')
    && journeySource.includes('state.get("status") != "offline"')
    && (journeySource.match(/result = request_json\("POST", "\/memory\/import"/g) ?? []).length === 1
    && conflictIndex >= 0
    && conflictIndex < stopIndex
    && stopIndex < panelIndex
    && panelIndex < successIndex;
}
check(
  packageImportIdleBarrierContract(realPackageJourney, desktopBridge),
  'real-package journey waits for exact session quiescence and verified extras shutdown before import',
);
for (const [label, journeyMutation, bridgeMutation = desktopBridge] of [
  ['unfinished-work response field', realPackageJourney, desktopBridge.replace(
    '"hasUnfinishedWork": self._session_has_unfinished_work(sess)',
    '"hasUnfinishedWork": False',
  )],
  ['strict unfinished-work predicate', realPackageJourney.replace(
    'snapshot.get("hasUnfinishedWork") is not False',
    'not snapshot.get("hasUnfinishedWork")',
  )],
  ['idle session predicate', realPackageJourney.replace(
    'status != "idle"',
    'False',
  )],
  ['terminal cancelled state', realPackageJourney.replace(
    'status in {"error", "cancelled"}',
    'status == "error"',
  )],
  ['failed conflict payload', realPackageJourney.replace(
    'payload.get("ok") is not False',
    'False',
  )],
  ['running-session conflict assertion', realPackageJourney.replace(
    'payload.get("runningSessions") != []',
    'False',
  )],
  ['conductor conflict assertion', realPackageJourney.replace(
    'CONDUCTOR_SERVICE_ID not in running_extras',
    'False',
  )],
  ['rejected-import immutability check', realPackageJourney.replace(
    'if import_target_snapshot() != before_conflict',
    'if False',
  )],
  ['stop-extras request', realPackageJourney.replace(
    '"/services/stop-extras"',
    '"/services/panel"',
  )],
  ['stopped panel running flag', realPackageJourney.replace(
    'state.get("running") is not False',
    'False',
  )],
  ['offline panel state', realPackageJourney.replace(
    'state.get("status") != "offline"',
    'False',
  )],
]) {
  check(
    !packageImportIdleBarrierContract(journeyMutation, bridgeMutation),
    `package import idle barrier rejects deleting ${label}`,
  );
}

check(tauriConfig.build?.frontendDist === '../dist', 'Tauri packages the React dist directory');
check(
  tauriConfig.build?.beforeBuildCommand === 'npm run build:tauri-assets',
  'Tauri builds and validates renderer assets before embedding',
);
check(
  tauriConfig.app?.security?.capabilities?.includes('default'),
  'Tauri explicitly enables the default capability',
);

console.log('\n[4] bootstrap and window capability contract');
check(
  Object.keys(REQUIRED_REACT_PUBLIC_ASSET_SHA256).every((asset) => REQUIRED_REACT_PUBLIC_ASSETS.includes(asset)),
  'hash-locked React v2 public assets are required bundle inputs',
);
for (const publicAsset of REQUIRED_REACT_PUBLIC_ASSETS) {
  const relativePath = `public/${publicAsset}`;
  const absolutePath = path.join(desktopRoot, relativePath);
  check(fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0, `${relativePath} is present`);
  const expectedHash = REQUIRED_REACT_PUBLIC_ASSET_SHA256[publicAsset];
  if (expectedHash && fs.existsSync(absolutePath)) {
    check(sha256(absolutePath) === expectedHash, `${relativePath} matches its required SHA-256`);
  }
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
