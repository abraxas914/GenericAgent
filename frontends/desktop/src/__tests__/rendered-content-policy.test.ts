// @vitest-environment node
import { describe, expect, it } from 'vitest';
import katex from 'katex';
import {
  normalizeExternalHttpUrl,
  normalizeMarkdownImageUrl,
  trustKatexCommand,
} from '../lib/rendered-content-policy';

describe('rendered content URL policy', () => {
  it('allows explicit HTTP(S) links and rejects every other link form', () => {
    expect(normalizeExternalHttpUrl('https://example.com/docs?q=1')).toBe('https://example.com/docs?q=1');
    expect(normalizeExternalHttpUrl('http://example.com')).toBe('http://example.com/');

    for (const value of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://example.com/id',
      '//example.com/path',
      '/relative/path',
      'https:\\example.com',
    ]) {
      expect(normalizeExternalHttpUrl(value)).toBeNull();
    }
  });

  it('blocks remote Markdown images but keeps bounded local image sources', () => {
    expect(normalizeMarkdownImageUrl('https://tracker.example/pixel.png')).toBeNull();
    expect(normalizeMarkdownImageUrl('http://127.0.0.1:14168/tracker.png')).toBeNull();
    expect(normalizeMarkdownImageUrl('//tracker.example/pixel.png')).toBeNull();
    expect(normalizeMarkdownImageUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeMarkdownImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();
    expect(normalizeMarkdownImageUrl('data:text/html,<script>alert(1)</script>')).toBeNull();

    expect(normalizeMarkdownImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(normalizeMarkdownImageUrl('blob:https://app.local/79d8')).toBe('blob:https://app.local/79d8');
    expect(normalizeMarkdownImageUrl('asset://localhost/tmp/diagram.png')).toBe('asset://localhost/tmp/diagram.png');
    expect(normalizeMarkdownImageUrl('asset://remote.example/tmp/diagram.png')).toBeNull();
    expect(normalizeMarkdownImageUrl('http://asset.localhost/tmp/diagram.png')).toBe('http://asset.localhost/tmp/diagram.png');
    expect(normalizeMarkdownImageUrl('/assets/ga-logo.svg')).toBe('/assets/ga-logo.svg');
    expect(normalizeMarkdownImageUrl('assets/preview.png?v=1')).toBe('assets/preview.png?v=1');
    expect(normalizeMarkdownImageUrl('/assets/../fallback.html')).toBeNull();
    expect(normalizeMarkdownImageUrl('/assets/%2e%2e/fallback.html')).toBeNull();
  });
});

describe('KaTeX trust policy', () => {
  it('keeps ordinary formulas renderable', () => {
    const html = katex.renderToString('\\frac{1}{n} \\sum_{i=1}^{n} x_i', {
      throwOnError: true,
      trust: trustKatexCommand,
    });
    expect(html).toContain('katex');
    expect(html).toContain('frac');
  });

  it('allows only explicit HTTP(S) href/url commands', () => {
    expect(trustKatexCommand({ command: '\\href', url: 'https://example.com', protocol: 'https' })).toBe(true);
    expect(trustKatexCommand({ command: '\\url', url: 'http://example.com', protocol: 'http' })).toBe(true);
    expect(trustKatexCommand({ command: '\\href', url: 'javascript:alert(1)', protocol: 'javascript' })).toBe(false);
    expect(trustKatexCommand({ command: '\\href', url: 'file:///etc/passwd', protocol: 'file' })).toBe(false);
    expect(trustKatexCommand({ command: '\\href', url: 'data:text/html,boom', protocol: 'data' })).toBe(false);
    expect(trustKatexCommand({ command: '\\href', url: '/relative', protocol: '_relative' })).toBe(false);
  });

  it('rejects every resource and arbitrary HTML command', () => {
    expect(trustKatexCommand({ command: '\\includegraphics', url: 'https://example.com/pixel.png', protocol: 'https' })).toBe(false);
    expect(trustKatexCommand({ command: '\\includegraphics', url: 'data:image/png;base64,AAAA', protocol: 'data' })).toBe(false);
    expect(trustKatexCommand({ command: '\\htmlStyle', style: 'background:url(https://example.com)' })).toBe(false);
    expect(trustKatexCommand({ command: '\\htmlClass', class: 'arbitrary' })).toBe(false);
  });

  it('does not emit dangerous links or external images', () => {
    const dangerousLink = katex.renderToString('\\href{javascript:alert(1)}{bad}', {
      throwOnError: false,
      trust: trustKatexCommand,
    });
    const externalImage = katex.renderToString('\\includegraphics{https://example.com/pixel.png}', {
      throwOnError: false,
      trust: trustKatexCommand,
    });

    expect(dangerousLink).not.toMatch(/href=["']javascript:/i);
    expect(externalImage).not.toContain('<img');
  });
});
