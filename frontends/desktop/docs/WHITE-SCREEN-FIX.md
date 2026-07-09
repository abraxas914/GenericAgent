# White Screen Fix — Prism.js + Vite esbuild Pre-bundling

## Problem
App renders white screen on `localhost:5173`. Console error:
```
TypeError: Cannot convert undefined or null to object
  at chunk-XXXXXX.js (prism-tsx.js)
```

## Root Cause
Prism.js language components are CJS IIFEs that expect a global `Prism` object AND
their upstream dependencies to be already registered on `Prism.languages`.

During Vite's esbuild pre-bundling phase:
1. esbuild splits components into **separate chunks** regardless of import order
2. Browser loads chunks in parallel → no execution order guarantee
3. `prism-tsx` executes before `prism-typescript` / `prism-jsx` → `Prism.languages.typescript` is `undefined` → crash

## Solution
Custom esbuild plugin in `vite.config.ts` that:
1. Intercepts all `prismjs/components/prism-*.js` files during pre-bundling
2. Prepends `var Prism = require("prismjs");` (provides core object)
3. Prepends `require("prismjs/components/prism-<dep>");` for **each upstream dependency**

This creates explicit dependency edges that esbuild respects during chunk splitting,
ensuring dependencies load before dependents.

### Dependency Map
```
prism-tsx       → [prism-markup, prism-javascript, prism-typescript, prism-jsx]
prism-jsx       → [prism-markup, prism-javascript]
prism-typescript→ [prism-javascript]
prism-cpp       → [prism-c]
prism-markdown  → [prism-markup]
```

## Key Lessons
- `import` order in source code does NOT control esbuild chunk execution order
- Go's RE2 regex (used by esbuild) does NOT support lookaheads like `(?!core)`
- `optimizeDeps.exclude` doesn't work for CJS modules lacking `export default`
- The only reliable fix is explicit `require()` dependency injection at build time

## Files Changed
- `vite.config.ts` — added `prismjsEsbuildPlugin()` to `optimizeDeps.esbuildOptions.plugins`
- `src/lib/prism-setup.ts` — reordered imports by dependency chain (cosmetic, not strictly needed with plugin)
