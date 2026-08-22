import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { SAFE_MARKDOWN_COMPONENTS } from './SafeMarkdownComponents';
import { preprocessMarkdown } from '../../../../lib/markdown-preprocess';
import {
  SAFE_KATEX_OPTIONS,
  renderedContentUrlTransform,
} from '../../../../lib/rendered-content-policy';

const KATEX_OPTIONS = {
  ...SAFE_KATEX_OPTIONS,
};

interface Props {
  content: string;
}

export const SummaryPart = memo(function SummaryPart({ content }: Props) {
  return (
    <div data-slot="summary-block">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={SAFE_MARKDOWN_COMPONENTS}
        urlTransform={renderedContentUrlTransform}
      >
        {preprocessMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
});
