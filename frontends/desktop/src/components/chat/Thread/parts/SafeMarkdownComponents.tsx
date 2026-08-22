import type { Components } from 'react-markdown';
import {
  normalizeExternalHttpUrl,
  normalizeMarkdownImageUrl,
} from '../../../../lib/rendered-content-policy';

/** Shared defense-in-depth components for every model-authored Markdown surface. */
export const SAFE_MARKDOWN_COMPONENTS: Components = {
  a({ href, children, node: _node, ...props }) {
    const safeHref = normalizeExternalHttpUrl(href ?? '');
    if (!safeHref) return <span data-slot="md-link-blocked">{children}</span>;

    return (
      <a
        {...props}
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  img({ src, alt, node: _node, ...props }) {
    const safeSrc = normalizeMarkdownImageUrl(src ?? '');
    if (!safeSrc) {
      return alt ? <span data-slot="md-image-blocked">{alt}</span> : null;
    }

    return (
      <img
        {...props}
        src={safeSrc}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
      />
    );
  },
};
