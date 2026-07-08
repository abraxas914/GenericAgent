import { memo, useCallback, useRef, useState } from 'react';
import { resolveLanguage, exceedsHighlightBudget, highlightCode } from '../../../../lib/prism-setup';
import './CodeBlock.css';

interface Props {
  language?: string;
  code: string;
  isStreaming: boolean;
}

export const CodeBlock = memo(function CodeBlock({ language: rawLang, code, isStreaming }: Props) {
  const lang = rawLang ? resolveLanguage(rawLang) : 'plaintext';
  const displayLang = rawLang || '';
  const shouldHighlight = !isStreaming && lang !== 'plaintext' && !exceedsHighlightBudget(code);

  return (
    <div data-slot="code-card" data-streaming={isStreaming || undefined}>
      <div data-slot="code-card-header">
        {displayLang && <span data-slot="code-card-lang">{displayLang}</span>}
        <CopyButton text={code} />
      </div>
      <div data-slot="code-card-body">
        {shouldHighlight ? (
          <code dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }} />
        ) : (
          <code>{code}</code>
        )}
      </div>
    </div>
  );
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;

  return (
    <button data-slot="code-card-copy" onClick={handleCopy} title={copied ? 'Copied' : 'Copy'}>
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="5.5" y="5.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3.5 10.5v-7a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
