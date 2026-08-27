// @vitest-environment happy-dom
import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Composer } from '../components/chat/Composer';
import { useThreadViewStore } from '../stores/thread-view';

const { uploadFileMock } = vi.hoisted(() => ({ uploadFileMock: vi.fn() }));

vi.mock('../services/chat', () => ({
  uploadFile: uploadFileMock,
}));

vi.mock('../components/chat/Composer/usePlaceholder', () => ({
  usePlaceholder: () => ({ text: 'Type a message' }),
}));

vi.mock('../components/chat/Composer/CompletionDrawer', () => ({
  CompletionDrawer: () => null,
}));

vi.mock('../components/chat/Composer/AtRefPopover', () => ({
  AtRefPopover: () => null,
}));

vi.mock('../components/chat/Composer/ContextMenu', () => ({
  ContextMenu: ({ onUploadFile }: { onUploadFile: () => void }) => (
    <button type="button" onClick={onUploadFile}>Attach</button>
  ),
}));

vi.mock('../components/chat/Composer/ModelSelector', () => ({
  ModelSelector: () => null,
}));

vi.mock('../components/chat/Composer/SkillPanel', () => ({
  SkillPanel: () => null,
}));

vi.mock('../components/chat/Composer/StatusStack', () => ({
  StatusStack: () => null,
}));

vi.mock('../stores/settings', () => ({
  useSettingsStore: (selector: (state: { lang: 'en' | 'zh' }) => unknown) => selector({ lang: 'en' }),
}));

vi.mock('../components/chat/Composer/RichEditorInput', () => {
  const RichEditorInput = forwardRef(function MockRichEditorInput(
    {
      placeholder,
      onInput,
      onKeyDown,
    }: {
      placeholder: string;
      onInput: (plainText: string) => void;
      onKeyDown: (e: React.KeyboardEvent) => void;
    },
    ref: React.ForwardedRef<{
      clear: () => void;
      getText: () => string;
      setText: (text: string) => void;
      focus: () => void;
      insertChip: () => void;
      setSkillChip: () => void;
      getElement: () => HTMLTextAreaElement | null;
    }>,
  ) {
    const [value, setValue] = useState('');

    useImperativeHandle(ref, () => ({
      clear() {
        setValue('');
        onInput('');
      },
      getText() {
        return value;
      },
      setText(text: string) {
        setValue(text);
        onInput(text);
      },
      focus() {},
      insertChip() {},
      setSkillChip() {},
      getElement() {
        return null;
      },
    }), [value, onInput]);

    return (
      <textarea
        aria-label="Composer input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onInput(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
    );
  });

  return { RichEditorInput };
});

class IdleFileReader {
  onload: null | ((event: { target: { result: string } }) => void) = null;
  onerror: null | (() => void) = null;
  error = null;

  readAsDataURL(_file: File) {}
}

class SuccessFileReader {
  onload: null | ((event: { target: { result: string } }) => void) = null;
  onerror: null | (() => void) = null;
  error = null;

  readAsDataURL(file: File) {
    queueMicrotask(() => {
      this.onload?.({ target: { result: `data:${file.type || 'application/octet-stream'};base64,AAAA` } });
    });
  }
}

class FailureFileReader {
  onload: null | ((event: { target: { result: string } }) => void) = null;
  onerror: null | (() => void) = null;
  error = new DOMException('unreadable');

  readAsDataURL(_file: File) {
    queueMicrotask(() => this.onerror?.());
  }
}

class DeferredFileReader {
  static instances: DeferredFileReader[] = [];
  onload: null | ((event: { target: { result: string } }) => void) = null;
  onerror: null | (() => void) = null;
  error = null;

  constructor() {
    DeferredFileReader.instances.push(this);
  }

  readAsDataURL(_file: File) {}

  resolve(result = 'data:text/plain;base64,AAAA') {
    this.onload?.({ target: { result } });
  }
}

function fileTransfer(
  files: File[],
  entries: Array<{ isDirectory: boolean; name: string }> = files.map((file) => ({ isDirectory: false, name: file.name })),
): DataTransfer {
  return {
    types: ['Files'],
    files,
    items: files.map((file, index) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
      webkitGetAsEntry: () => entries[index],
    })),
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function textTransfer(): DataTransfer {
  return {
    types: ['text/plain', 'text/uri-list'],
    files: [],
    items: [],
    dropEffect: 'none',
  } as unknown as DataTransfer;
}

function composerRoot(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-slot="composer-root"]') as HTMLElement;
}

describe('Composer attachment lifecycle', () => {
  const originalFileReader = globalThis.FileReader;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    uploadFileMock.mockReset();
    DeferredFileReader.instances = [];
    useThreadViewStore.setState({ viewBySessionId: {} });
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
  });

  it('turns a dropped image into a ready thumbnail', async () => {
    globalThis.FileReader = SuccessFileReader as unknown as typeof FileReader;
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const image = new File(['png'], 'diagram.png', { type: 'image/png' });

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer([image]) });

    const thumbnail = await screen.findByAltText('diagram.png') as HTMLImageElement;
    expect(thumbnail.src).toContain('data:image/png;base64,AAAA');
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('uploads a dropped ordinary file exactly once and renders a ready chip', async () => {
    globalThis.FileReader = SuccessFileReader as unknown as typeof FileReader;
    uploadFileMock.mockResolvedValue('/bridge/draft.txt');
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const file = new File(['hello'], 'draft.txt', { type: 'text/plain' });

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer([file]) });

    await screen.findByText('draft.txt');
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));
    expect(uploadFileMock).toHaveBeenCalledWith('draft.txt', 'data:text/plain;base64,AAAA');
    await waitFor(() => {
      expect(container.querySelector('[data-slot="attachment-file-chip"]')?.getAttribute('data-status')).toBe('ready');
    });
  });

  it('keeps mixed dropped files in source order without duplicates', async () => {
    globalThis.FileReader = SuccessFileReader as unknown as typeof FileReader;
    uploadFileMock.mockImplementation(async (name: string) => `/bridge/${name}`);
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const files = [
      new File(['png'], 'first.png', { type: 'image/png' }),
      new File(['pdf'], 'second.pdf', { type: 'application/pdf' }),
      new File(['txt'], 'third.txt', { type: 'text/plain' }),
    ];

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer(files) });

    await screen.findByAltText('first.png');
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(2));
    const strip = container.querySelector('[data-slot="attachment-strip"]') as HTMLElement;
    const names = Array.from(strip.children).map((child) => (
      child.querySelector('img')?.getAttribute('alt')
      || child.querySelector('[data-slot="attachment-file-name"]')?.textContent
    ));
    expect(names).toEqual(['first.png', 'second.pdf', 'third.txt']);
  });

  it('does not show an overlay or prevent default for text and URL drags', () => {
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const root = composerRoot(container);
    const transfer = textTransfer();

    expect(fireEvent.dragEnter(root, { dataTransfer: transfer })).toBe(true);
    expect(fireEvent.dragOver(root, { dataTransfer: transfer })).toBe(true);
    expect(screen.queryByText('Drop to upload files')).toBeNull();
    expect(fireEvent.drop(root, { dataTransfer: transfer })).toBe(true);
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('keeps the file overlay visible while crossing composer children', () => {
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const root = composerRoot(container);
    const child = screen.getByRole('button', { name: 'Attach' });
    const transfer = fileTransfer([new File(['hello'], 'draft.txt', { type: 'text/plain' })]);

    fireEvent.dragEnter(root, { dataTransfer: transfer });
    expect(screen.getByText('Drop to upload files')).not.toBeNull();
    fireEvent.dragEnter(child, { dataTransfer: transfer });
    fireEvent.dragLeave(child, { dataTransfer: transfer });
    expect(screen.getByText('Drop to upload files')).not.toBeNull();
    fireEvent.dragLeave(root, { dataTransfer: transfer });
    expect(screen.queryByText('Drop to upload files')).toBeNull();
  });

  afterEach(() => {
    globalThis.FileReader = originalFileReader;
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('disables the CTA while a non-image file is still uploading', async () => {
    globalThis.FileReader = IdleFileReader as unknown as typeof FileReader;

    render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]:not([accept])') as HTMLInputElement;
    const file = new File(['hello'], 'draft.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('draft.txt')).not.toBeNull();
    });

    const cta = screen.getByRole('button', { name: 'Send message' });
    expect(cta.getAttribute('data-state')).toBe('disabled');
    expect((cta as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a localized upload error and retries through the same pipeline', async () => {
    globalThis.FileReader = SuccessFileReader as unknown as typeof FileReader;
    uploadFileMock.mockRejectedValueOnce(new Error('upload failed')).mockResolvedValueOnce('/bridge/broken.txt');

    render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);

    const fileInput = document.querySelector('input[type="file"]:not([accept])') as HTMLInputElement;
    const file = new File(['hello'], 'broken.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('broken.txt')).not.toBeNull();
    });

    const retry = await screen.findByRole('button', { name: 'Retry upload' });
    expect(screen.getByText('Upload failed')).not.toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Upload failed')).toBeNull());
  });

  it('removes an uploading attachment without letting a late read revive or upload it', async () => {
    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const file = new File(['hello'], 'remove-me.txt', { type: 'text/plain' });

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer([file]) });
    await screen.findByText('remove-me.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('remove-me.txt')).toBeNull();

    DeferredFileReader.instances[0].resolve();
    await Promise.resolve();
    expect(screen.queryByText('remove-me.txt')).toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('shows explicit errors for folders, empty files, and oversized files', async () => {
    globalThis.FileReader = SuccessFileReader as unknown as typeof FileReader;
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const folder = new File(['folder'], 'examples', { type: '' });
    const empty = new File([], 'empty.txt', { type: 'text/plain' });
    const oversized = new File(['large'], 'large.zip', { type: 'application/zip' });
    Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 });
    const entries = [
      { isDirectory: true, name: 'examples' },
      { isDirectory: false, name: 'empty.txt' },
      { isDirectory: false, name: 'large.zip' },
    ];

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer([folder, empty, oversized], entries) });

    expect(await screen.findByText('Folders cannot be attached')).not.toBeNull();
    expect(screen.getByText('Empty files cannot be attached')).not.toBeNull();
    expect(screen.getByText('File exceeds the 50 MB limit')).not.toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('shows an explicit retryable error when FileReader cannot read a file', async () => {
    globalThis.FileReader = FailureFileReader as unknown as typeof FileReader;
    const { container } = render(<Composer onSend={vi.fn()} onStop={vi.fn()} isGenerating={false} />);
    const file = new File(['hello'], 'unreadable.txt', { type: 'text/plain' });

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer([file]) });

    expect(await screen.findByText('Could not read this file')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry upload' })).not.toBeNull();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it('sends dropped files and images with the same bridge metadata as picker attachments', async () => {
    globalThis.FileReader = SuccessFileReader as unknown as typeof FileReader;
    uploadFileMock.mockResolvedValue('/bridge/report.pdf');
    const onSend = vi.fn();
    const { container } = render(<Composer onSend={onSend} onStop={vi.fn()} isGenerating={false} />);
    const image = new File(['png'], 'photo.png', { type: 'image/png' });
    const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer([image, file]) });

    await screen.findByAltText('photo.png');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send message' }).getAttribute('data-state')).toBe('send');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledWith('', {
      files: [{ name: 'report.pdf', path: '/bridge/report.pdf', size: 3 }],
      images: [{ name: 'photo.png', path: 'photo.png', base64: 'data:image/png;base64,AAAA' }],
    });
  });

  it('restores drafts and attachments when switching between sessions', async () => {
    globalThis.FileReader = IdleFileReader as unknown as typeof FileReader;
    const props = { onSend: vi.fn(), onStop: vi.fn(), isGenerating: false };
    const { rerender } = render(<Composer {...props} sessionId="A" />);

    fireEvent.change(screen.getByLabelText('Composer input'), { target: { value: 'draft A' } });
    const fileInput = document.querySelector('input[type="file"]:not([accept])') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['hello'], 'a.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(screen.getByText('a.txt')).not.toBeNull());

    rerender(<Composer {...props} sessionId="B" />);
    expect((screen.getByLabelText('Composer input') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('a.txt')).toBeNull();
    fireEvent.change(screen.getByLabelText('Composer input'), { target: { value: 'draft B' } });

    rerender(<Composer {...props} sessionId="A" />);
    expect((screen.getByLabelText('Composer input') as HTMLTextAreaElement).value).toBe('draft A');
    expect(screen.getByText('a.txt')).not.toBeNull();
  });

  it('writes a late upload result back to the session where ingestion started', async () => {
    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    uploadFileMock.mockResolvedValue('/bridge/a.txt');
    const props = { onSend: vi.fn(), onStop: vi.fn(), isGenerating: false };
    const { container, rerender } = render(<Composer {...props} sessionId="A" />);
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });

    fireEvent.drop(composerRoot(container), { dataTransfer: fileTransfer([file]) });
    await screen.findByText('a.txt');
    rerender(<Composer {...props} sessionId="B" />);
    expect(screen.queryByText('a.txt')).toBeNull();

    DeferredFileReader.instances[0].resolve();
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(useThreadViewStore.getState().viewBySessionId.A.attachments).toEqual([
        expect.objectContaining({ name: 'a.txt', path: '/bridge/a.txt', status: 'ready' }),
      ]);
    });
    expect(useThreadViewStore.getState().viewBySessionId.B?.attachments ?? []).toEqual([]);

    rerender(<Composer {...props} sessionId="A" />);
    expect(screen.getByText('a.txt')).not.toBeNull();
    expect(container.querySelector('[data-slot="attachment-file-chip"]')?.getAttribute('data-status')).toBe('ready');
  });
});
