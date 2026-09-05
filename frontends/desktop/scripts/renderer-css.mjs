// Supported desktop engines all support WOFF2. Remove fallbacks before Vite
// resolves CSS URLs so unused WOFF/TTF files never enter the asset graph.
export function katexWoff2Only() {
  return {
    postcssPlugin: 'ga-katex-woff2-only',
    AtRule: {
      'font-face'(rule) {
        const family = rule.nodes.find((node) => node.prop === 'font-family')?.value;
        if (!family?.replace(/["']/g, '').startsWith('KaTeX_')) return;
        rule.walkDecls('src', (declaration) => {
          const woff2 = declaration.value.match(/url\([^)]+\)\s*format\((["'])woff2\1\)/);
          if (!woff2) throw declaration.error('KaTeX face has no WOFF2 source');
          declaration.value = woff2[0];
        });
      },
    },
  };
}
