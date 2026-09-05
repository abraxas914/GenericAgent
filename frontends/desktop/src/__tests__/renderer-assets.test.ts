// @vitest-environment node
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { katexWoff2Only } from '../../scripts/renderer-css.mjs';
import { rendererBudgetError } from '../../scripts/renderer-size.mjs';

describe('renderer asset boundaries', () => {
  it('retains WOFF2 for every KaTeX face without changing unrelated fonts', async () => {
    const css = `@font-face { font-family: KaTeX_Main; src: url(main.woff2) format("woff2"), url(main.woff) format("woff"), url(main.ttf) format("truetype"); }
      @font-face { font-family: Other; src: url(other.ttf) format("truetype"); }`;
    const emitted: string[] = [];
    const urlResolver = {
      postcssPlugin: 'record-emitted-urls',
      Once(root: import('postcss').Root) {
        root.walkDecls('src', (decl) => { emitted.push(decl.value); });
      },
    };
    const result = await postcss([katexWoff2Only(), urlResolver]).process(css, { from: undefined });
    expect(emitted[0]).toBe('url(main.woff2) format("woff2")');
    expect(result.css).toContain('url(main.woff2)');
    expect(result.css).not.toContain('url(main.woff)');
    expect(result.css).not.toContain('url(main.ttf)');
    expect(result.css).toContain('url(other.ttf)');
  });

  it('fails if a KaTeX update removes the supported font format', async () => {
    await expect(postcss([katexWoff2Only()]).process(
      '@font-face { font-family: KaTeX_Main; src: url(main.ttf) format("truetype"); }',
      { from: undefined },
    )).rejects.toThrow('no WOFF2 source');
  });

  it('rejects aggregate growth even when individual chunks could stay small', () => {
    expect(rendererBudgetError({ js: 2_250_001, css: 0, fonts: 0, total: 2_250_001 })).toContain('js');
    expect(rendererBudgetError({ js: 1, css: 450_001, fonts: 0, total: 450_002 })).toContain('css');
    expect(rendererBudgetError({ js: 1, css: 0, fonts: 280_001, total: 280_002 })).toContain('fonts');
    expect(rendererBudgetError({ js: 1, css: 0, fonts: 0, total: 3_100_001 })).toContain('total');
  });
});
