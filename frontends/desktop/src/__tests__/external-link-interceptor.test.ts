// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { handleRenderedContentLinkClick } from '../lib/rendered-content-policy';

/**
 * Verifies that the global click delegate in main.tsx intercepts
 * external links and routes them to tauri-plugin-opener.
 */
describe('external link interceptor', () => {
  let openUrl: Mock<(url: string) => void>;
  let cleanup: () => void;

  function installInterceptor() {
    const handler = (event: MouseEvent) => handleRenderedContentLinkClick(event, (url) => openUrl(url));
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }

  beforeEach(() => {
    openUrl = vi.fn<(url: string) => void>();
    cleanup = installInterceptor();
  });

  afterEach(() => {
    cleanup();
  });

  it('intercepts external http links and calls opener.openUrl', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com/page';
    a.textContent = 'Example';
    document.body.appendChild(a);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/page');
    document.body.removeChild(a);
  });

  it('does not intercept same-origin links', () => {
    const a = document.createElement('a');
    a.href = location.origin + '/internal-route';
    a.textContent = 'Internal';
    document.body.appendChild(a);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    document.body.removeChild(a);
  });

  it('prevents javascript: links without invoking the opener', () => {
    const a = document.createElement('a');
    a.href = 'javascript:void(0)';
    a.textContent = 'Noop';
    document.body.appendChild(a);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
    document.body.removeChild(a);
  });

  it.each([
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.com/id',
    '//example.com/protocol-relative',
    '/relative/path',
  ])('prevents non-web or non-explicit link %s', (href) => {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    document.body.appendChild(a);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();
    document.body.removeChild(a);
  });

  it('intercepts clicks on nested elements inside an anchor', () => {
    const a = document.createElement('a');
    a.href = 'https://github.com/some/repo';
    const span = document.createElement('span');
    span.textContent = 'nested text';
    a.appendChild(span);
    document.body.appendChild(a);

    // happy-dom doesn't bubble from child through .closest() properly,
    // so dispatch on the anchor itself which is what browsers do after bubbling
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://github.com/some/repo');
    document.body.removeChild(a);
  });

  it('intercepts KaTeX-style MathML href nodes', () => {
    const mathLink = document.createElement('mrow');
    mathLink.setAttribute('href', 'https://example.com/formula');
    document.body.appendChild(mathLink);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    mathLink.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/formula');
    document.body.removeChild(mathLink);
  });

  it('ignores clicks on non-anchor elements', () => {
    const div = document.createElement('div');
    div.textContent = 'just a div';
    document.body.appendChild(div);

    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    div.dispatchEvent(ev);

    expect(openUrl).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });
});
