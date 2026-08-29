// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThinkingPart } from '../components/chat/Thread/parts/ThinkingPart';
import { ToolPart } from '../components/chat/Thread/parts/ToolPart';
import { ResultPart } from '../components/chat/Thread/parts/ResultPart';
import { stableSegmentId } from '../components/chat/Thread/parts';
import { useThreadViewStore } from '../stores/thread-view';

describe('session-scoped thread view state', () => {
  beforeEach(() => {
    useThreadViewStore.setState({ viewBySessionId: {} });
  });

  afterEach(() => cleanup());

  it('preserves render budget, scroll, drafts, and attachments per session', () => {
    const store = useThreadViewStore.getState();
    store.setRenderBudget('A', 3);
    store.setRenderBudget('B', 2);
    store.setScrollState('A', { scrollTop: 420 }, false);
    store.setScrollState('B', { scrollTop: 0 }, true);
    store.setComposerDraft('A', 'draft A');
    store.setComposerDraft('B', 'draft B');
    store.updateAttachments('A', () => [{
      id: 'a-file',
      name: 'a.txt',
      size: 1,
      type: 'file',
      status: 'ready',
    }]);

    const { viewBySessionId } = useThreadViewStore.getState();
    expect(viewBySessionId.A.renderBudgetMultiplier).toBe(3);
    expect(viewBySessionId.B.renderBudgetMultiplier).toBe(2);
    expect(viewBySessionId.A.scrollAnchor?.scrollTop).toBe(420);
    expect(viewBySessionId.A.followingTail).toBe(false);
    expect(viewBySessionId.B.followingTail).toBe(true);
    expect(viewBySessionId.A.composerDraft).toBe('draft A');
    expect(viewBySessionId.B.composerDraft).toBe('draft B');
    expect(viewBySessionId.A.attachments[0].name).toBe('a.txt');
    expect(viewBySessionId.B.attachments).toEqual([]);
  });

  it('uses a stable segment id with session, message, turn, index, and type', () => {
    const first = stableSegmentId('A', 'message', 2, 3, 'thinking');
    expect(first).toContain('A:message:2:3:thinking');
    expect(stableSegmentId('B', 'message', 2, 3, 'thinking')).not.toBe(first);
    expect(stableSegmentId('A', 'message', 3, 3, 'thinking')).not.toBe(first);
    expect(stableSegmentId('A', 'message', 2, 3, 'tool')).not.toBe(first);
  });

  it('keeps a manually collapsed streaming segment collapsed after remount', () => {
    const segmentKey = stableSegmentId('A', 'message', 0, 0, 'thinking');
    const firstRender = render(
      <ThinkingPart
        sessionId="A"
        segmentKey={segmentKey}
        content="working"
        isStreaming
      />,
    );

    const details = screen.getByText('Thinking').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    fireEvent.click(screen.getByText('Thinking'));
    expect(details.open).toBe(false);

    firstRender.unmount();
    render(
      <ThinkingPart
        sessionId="A"
        segmentKey={segmentKey}
        content="still working"
        isStreaming
      />,
    );
    expect((screen.getByText('Thinking').closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('defaults each new streaming segment to expanded without reopening a collapsed peer', () => {
    const first = stableSegmentId('A', 'message', 0, 0, 'thinking');
    const second = stableSegmentId('A', 'message', 0, 1, 'thinking');
    useThreadViewStore.getState().setSegmentExpanded('A', first, false);

    render(
      <>
        <ThinkingPart sessionId="A" segmentKey={first} content="first" isStreaming />
        <ThinkingPart sessionId="A" segmentKey={second} content="second" isStreaming />
      </>,
    );

    const disclosures = screen.getAllByText('Thinking').map(
      (label) => label.closest('details') as HTMLDetailsElement,
    );
    expect(disclosures[0].open).toBe(false);
    expect(disclosures[1].open).toBe(true);
  });

  it('restores tool and result disclosure state after component remounts', () => {
    const toolKey = stableSegmentId('A', 'message', 0, 0, 'tool');
    const resultKey = stableSegmentId('A', 'message', 0, 1, 'result');
    const longResult = 'r'.repeat(240);
    const firstRender = render(
      <>
        <ToolPart sessionId="A" segmentKey={toolKey} name="search" content="tool detail" inFlight={false} />
        <ResultPart sessionId="A" segmentKey={resultKey} content={longResult} inFlight={false} />
      </>,
    );

    fireEvent.click(screen.getByText('search'));
    fireEvent.click(screen.getByText('Output'));
    expect(screen.getByText('tool detail')).toBeTruthy();
    expect(screen.getByText(longResult)).toBeTruthy();

    firstRender.unmount();
    render(
      <>
        <ToolPart sessionId="A" segmentKey={toolKey} name="search" content="tool detail" inFlight={false} />
        <ResultPart sessionId="A" segmentKey={resultKey} content={longResult} inFlight={false} />
      </>,
    );
    expect(screen.getByText('tool detail')).toBeTruthy();
    expect(screen.getByText(longResult)).toBeTruthy();
  });

  it('cleans the view bucket when a session is deleted', () => {
    useThreadViewStore.getState().setComposerDraft('A', 'draft');
    useThreadViewStore.getState().deleteSession('A');
    expect(useThreadViewStore.getState().viewBySessionId.A).toBeUndefined();
  });
});
