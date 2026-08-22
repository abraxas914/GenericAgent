import type { KatexOptions, TrustContext } from 'katex';
import type { UrlTransform } from 'react-markdown';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const KATEX_LINK_COMMANDS = new Set(['\\href', '\\url']);
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i;
const LOCAL_ASSET_PATH = /^(?:\/|\.\/)?assets\//;
const ENCODED_PATH_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Only browser-safe external web links are actionable in rendered model output.
 * Requiring `//` after the scheme also rejects relative and protocol-relative URLs.
 */
export function normalizeExternalHttpUrl(value: string): string | null {
  const candidate = value.trim();
  if (!/^https?:\/\//i.test(candidate) || CONTROL_CHARACTER.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    return HTTP_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeLocalAssetPath(value: string): string | null {
  if (
    !LOCAL_ASSET_PATH.test(value)
    || value.startsWith('//')
    || value.includes('\\')
    || ENCODED_PATH_SEPARATOR_OR_DOT.test(value)
  ) {
    return null;
  }

  try {
    const url = new URL(value, 'https://genericagent.invalid/');
    return url.origin === 'https://genericagent.invalid'
      && url.pathname.startsWith('/assets/')
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Markdown images are local-first. Remote HTTP(S) URLs never receive a `src`.
 * Allowed sources are bounded bitmap data URLs, in-page blob URLs, Tauri asset
 * protocol URLs, and files under the renderer's own `/assets/` directory.
 */
export function normalizeMarkdownImageUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || CONTROL_CHARACTER.test(candidate)) return null;

  if (SAFE_DATA_IMAGE.test(candidate)) return candidate;
  if (/^blob:/i.test(candidate)) {
    try {
      return new URL(candidate).protocol === 'blob:' ? candidate : null;
    } catch {
      return null;
    }
  }
  if (/^asset:/i.test(candidate)) {
    try {
      const url = new URL(candidate);
      return url.protocol === 'asset:'
        && (url.hostname === '' || url.hostname === 'localhost')
        && !url.username
        && !url.password
        ? candidate
        : null;
    } catch {
      return null;
    }
  }

  // Tauri uses this host form for converted local asset URLs on some platforms.
  if (/^https?:\/\/asset\.localhost(?:\/|$)/i.test(candidate)) {
    try {
      const url = new URL(candidate);
      return url.hostname === 'asset.localhost' && HTTP_PROTOCOLS.has(url.protocol)
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  return normalizeLocalAssetPath(candidate);
}

/** ReactMarkdown applies this policy after remark/rehype plugins have run. */
export const renderedContentUrlTransform: UrlTransform = (value, key, node) => {
  if (key === 'href') return normalizeExternalHttpUrl(value) ?? undefined;
  if (key === 'src' && node.tagName === 'img') return normalizeMarkdownImageUrl(value) ?? undefined;
  return undefined;
};

/**
 * KaTeX may create links, but never images or arbitrary HTML attributes/styles.
 * Relative URLs and non-HTTP(S) protocols are rejected before markup is emitted.
 */
export function trustKatexCommand(context: TrustContext): boolean {
  if (!KATEX_LINK_COMMANDS.has(context.command) || !('url' in context)) return false;
  return normalizeExternalHttpUrl(context.url) !== null;
}

export const SAFE_KATEX_OPTIONS = {
  strict: 'ignore',
  trust: trustKatexCommand,
} satisfies KatexOptions;

export type ExternalUrlOpener = (url: string) => unknown;

/**
 * Block unsafe link navigation in every renderer. In Tauri, allowed external
 * links are delegated to the opener plugin instead of navigating the webview.
 */
export function handleRenderedContentLinkClick(
  event: MouseEvent,
  openExternal?: ExternalUrlOpener,
): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  // KaTeX emits `href` on both HTML anchors and hidden accessible MathML nodes.
  const link = target.closest('[href]');
  if (!link) return;

  const safeUrl = normalizeExternalHttpUrl(link.getAttribute('href') ?? '');
  if (!safeUrl) {
    event.preventDefault();
    return;
  }

  const destination = new URL(safeUrl);
  if (!openExternal || destination.origin === location.origin) return;

  event.preventDefault();
  try {
    void Promise.resolve(openExternal(safeUrl)).catch((error: unknown) => {
      console.error('[external-link] opener failed:', error);
    });
  } catch (error) {
    console.error('[external-link] opener failed:', error);
  }
}
