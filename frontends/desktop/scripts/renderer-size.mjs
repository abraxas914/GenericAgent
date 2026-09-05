import fs from 'node:fs';
import path from 'node:path';

export const RENDERER_BUDGETS = { js: 2_250_000, css: 450_000, fonts: 280_000, total: 3_100_000 };

export function measureRenderer(root) {
  const sizes = {};
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else sizes[path.relative(root, file).split(path.sep).join('/')] = fs.statSync(file).size;
    }
  }
  walk(root);
  const report = { js: 0, css: 0, fonts: 0, other: 0, total: 0, files: Object.keys(sizes).length, entries: {} };
  for (const [name, bytes] of Object.entries(sizes)) {
    const category = name.endsWith('.js') ? 'js' : name.endsWith('.css') ? 'css'
      : /\.(woff2?|ttf|otf)$/.test(name) ? 'fonts' : 'other';
    report[category] += bytes;
    report.total += bytes;
  }
  // Direct script, stylesheet and modulepreload references, not a claim about
  // measured network traffic or dynamically loaded resources.
  for (const entry of ['index.html', 'loading.html', 'setup.html']) {
    if (!fs.existsSync(path.join(root, entry))) continue;
    const html = fs.readFileSync(path.join(root, entry), 'utf8');
    const assets = new Set([...html.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+\.(?:js|css))["']/g)].map((m) => m[1]));
    report.entries[entry] = [...assets].reduce((sum, asset) => sum + (sizes[asset] ?? 0), 0);
  }
  return report;
}

export function rendererBudgetError(report) {
  for (const [category, budget] of Object.entries(RENDERER_BUDGETS)) {
    if (report[category] > budget) return `Renderer ${category}: ${report[category]} bytes exceeds ${budget}`;
  }
  return null;
}
