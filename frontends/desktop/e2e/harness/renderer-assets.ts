import assert from 'node:assert/strict';

// Run after rendering a Markdown reply so its lazy stylesheet is present.
export async function assertRendererAssets(): Promise<void> {
  const evidence = await browser.execute(async () => {
    await document.fonts.ready;
    const faces: FontFace[] = [];
    document.fonts.forEach((face) => {
      if (face.family.replace(/["']/g, '').startsWith('KaTeX_')) faces.push(face);
    });
    await Promise.all(faces.map((face) => face.load()));
    const body = document.body;
    const mode = body.getAttribute('theme-mode');
    body.removeAttribute('theme-mode');
    const light = getComputedStyle(body).getPropertyValue('--semi-color-bg-0').trim();
    body.setAttribute('theme-mode', 'dark');
    const dark = getComputedStyle(body).getPropertyValue('--semi-color-bg-0').trim();
    if (mode === null) body.removeAttribute('theme-mode');
    else body.setAttribute('theme-mode', mode);
    const icon = document.querySelector('.codicon svg')?.getBoundingClientRect();
    return {
      fonts: faces.length,
      loaded: faces.every((face) => face.status === 'loaded'),
      light, dark,
      iconWidth: icon?.width ?? 0,
      iconHeight: icon?.height ?? 0,
    };
  });
  assert.ok(evidence.fonts >= 20 && evidence.loaded, `KaTeX fonts failed: ${JSON.stringify(evidence)}`);
  assert.ok(evidence.light && evidence.dark && evidence.light !== evidence.dark, 'Semi light/dark base tokens must remain available');
  assert.ok(evidence.iconWidth > 0 && evidence.iconHeight > 0, 'inline Codicons must have visible geometry');
}
