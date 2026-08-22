// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownPart } from '../components/chat/Thread/parts/MarkdownPart';
import { SummaryPart } from '../components/chat/Thread/parts/SummaryPart';

afterEach(cleanup);

describe('model-authored Markdown rendering boundary', () => {
  it('does not give remote Markdown images a loadable src', () => {
    const { container } = render(
      <>
        <MarkdownPart content="![tracking pixel](https://tracker.example/pixel.png)" />
        <SummaryPart content="![summary tracker](http://tracker.example/pixel.png)" />
      </>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('tracking pixel').getAttribute('data-slot')).toBe('md-image-blocked');
    expect(screen.getByText('summary tracker').getAttribute('data-slot')).toBe('md-image-blocked');
  });

  it('keeps a bounded embedded bitmap image available', () => {
    render(<MarkdownPart content="![local preview](data:image/png;base64,AAAA)" />);

    const image = screen.getByRole('img', { name: 'local preview' });
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(image.getAttribute('loading')).toBe('lazy');
  });

  it('renders ordinary formulas in Markdown and summaries', () => {
    const { container } = render(
      <>
        <MarkdownPart content={'Pythagoras: $x^2 + y^2 = z^2$'} />
        <SummaryPart content={'Euler: $e^{i\\pi} + 1 = 0$'} />
      </>,
    );

    expect(container.querySelectorAll('.katex')).toHaveLength(2);
  });

  it('keeps an ordinary HTTPS link actionable and hardened', () => {
    render(<MarkdownPart content="Read the [documentation](https://example.com/docs)." />);

    const link = screen.getByRole('link', { name: 'documentation' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('allows an explicit HTTPS KaTeX link through the same URL boundary', () => {
    const { container } = render(
      <SummaryPart content={'$\\href{https://example.com/formula}{reference}$'} />,
    );

    const linkedNodes = [...container.querySelectorAll('[href]')];
    expect(linkedNodes.length).toBeGreaterThan(0);
    expect(linkedNodes.every((node) => node.getAttribute('href') === 'https://example.com/formula')).toBe(true);
  });

  it('removes dangerous Markdown links and KaTeX resource commands', () => {
    const { container } = render(
      <MarkdownPart
        content={'[run](javascript:alert(1))\n\n$\\includegraphics{https://tracker.example/pixel.png}$'}
      />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('run').getAttribute('data-slot')).toBe('md-link-blocked');
  });
});
