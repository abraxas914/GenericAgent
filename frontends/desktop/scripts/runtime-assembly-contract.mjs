import fs from 'node:fs';

// Let the existing workflow contracts inspect sourced code as well as call sites.
// Runtime behavior is exercised separately on all three packaging platforms.
export function expandRuntimeAssembly(workflow) {
  const helper = fs.readFileSync(
    new URL('../packaging/scripts/runtime-assembly.sh', import.meta.url), 'utf8',
  );
  return workflow.replaceAll(
    '          source frontends/desktop/packaging/scripts/runtime-assembly.sh',
    helper.split('\n').map((line) => `          ${line}`).join('\n'),
  );
}
