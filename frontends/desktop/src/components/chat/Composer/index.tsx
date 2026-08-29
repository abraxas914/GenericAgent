import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import type { SendOptions } from '../../../stores/chat';
import {
  sessionViewId,
  useThreadViewStore,
  type AttachmentFile,
} from '../../../stores/thread-view';
import { RichEditorInput, type RichEditorHandle } from './RichEditorInput';
import { CompletionDrawer } from './CompletionDrawer';
import { AtRefPopover } from './AtRefPopover';
import { ContextMenu } from './ContextMenu';
import { ModelSelector } from './ModelSelector';
import { AttachmentStrip } from './AttachmentStrip';
import { SkillPanel } from './SkillPanel';
import { PrimaryCTA, computeCTAState } from './PrimaryCTA';
import { StatusStack } from './StatusStack';
import { usePlaceholder } from './usePlaceholder';
import { useI18n } from '../../../i18n';
import { candidatesFromDataTransfer, isFileDrag, useAttachmentIngestion } from './useAttachmentIngestion';
import { statDroppedPath } from '../../../services/chat';
import { useSettingsStore } from '../../../stores/settings';
import { useChatStore } from '../../../stores/chat';
import './composer.css';

// Mixin cannot consume the desktop image payload. Use the authoritative
// session/default profile binding and degrade native image paths to prompt text.
function currentModelIsMixin(): boolean {
  const { modelProfiles, defaultModelNo } = useSettingsStore.getState();
  const sessionModelNo = useChatStore.getState().sessionModelNo;
  const no = sessionModelNo ?? defaultModelNo;
  return modelProfiles[no]?.kind === 'mixin';
}

interface Props {
  sessionId?: string | null;
  onSend: (text: string, opts?: SendOptions) => void;
  onStop: () => void;
  isGenerating: boolean;
  editorRef?: React.RefObject<RichEditorHandle | null>;
  hideStatusStack?: boolean;
  modelControl?: React.ReactNode | null;
}

let composerInstanceCounter = 0;
let nativeAttachmentIdCounter = 0;
const EMPTY_ATTACHMENTS: AttachmentFile[] = [];

export function Composer({ sessionId, onSend, onStop, isGenerating, editorRef: externalEditorRef, hideStatusStack, modelControl }: Props) {
  const internalEditorRef = useRef<RichEditorHandle>(null);
  const editorRef = (externalEditorRef ?? internalEditorRef) as React.RefObject<RichEditorHandle>;
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const { text: placeholderText } = usePlaceholder();
  const { t } = useI18n();
  const [standaloneViewId] = useState(() => `__composer_instance_${++composerInstanceCounter}__`);
  const viewSessionId = sessionId === undefined ? standaloneViewId : sessionId;
  const viewId = sessionViewId(viewSessionId);
  const plainText = useThreadViewStore(
    (state) => state.viewBySessionId[viewId]?.composerDraft ?? '',
  );
  const attachments = useThreadViewStore(
    (state) => state.viewBySessionId[viewId]?.attachments ?? EMPTY_ATTACHMENTS,
  );
  const setComposerDraft = useThreadViewStore((state) => state.setComposerDraft);
  const updateAttachments = useThreadViewStore((state) => state.updateAttachments);
  const updateViewAttachments = useCallback(
    (updater: (current: AttachmentFile[]) => AttachmentFile[]) => {
      updateAttachments(viewSessionId, updater);
    },
    [updateAttachments, viewSessionId],
  );
  const {
    ingestCandidates,
    ingestFiles,
    removeAttachment,
    retryAttachment,
    clearAttachments,
  } = useAttachmentIngestion({
    t,
    attachments,
    updateAttachments: updateViewAttachments,
  });

  const processDroppedPaths = useCallback((paths: string[]) => {
    for (const path of paths) {
      const id = `att-native-${++nativeAttachmentIdCounter}`;
      const fallbackName = path.split(/[\\/]/).pop() || path;
      const looksImage = /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(fallbackName);
      updateViewAttachments((current) => [...current, {
        id,
        name: fallbackName,
        size: 0,
        type: looksImage ? 'image' : 'file',
        status: 'uploading',
        path,
      }]);

      void statDroppedPath(path, looksImage).then((stat) => {
        updateViewAttachments((current) => current.map((item) => {
          if (item.id !== id) return item;
          if (!stat) {
            return {
              ...item,
              status: 'error',
              errorMsg: t('upload.readFailed'),
              retryable: false,
            };
          }
          if (looksImage && stat.preview) {
            return {
              ...item,
              name: stat.name,
              size: stat.size,
              type: 'image',
              preview: stat.preview,
              status: 'ready',
              errorMsg: undefined,
            };
          }
          return {
            ...item,
            name: stat.name,
            size: stat.size,
            type: 'file',
            status: 'ready',
            errorMsg: undefined,
          };
        }));
      });
    }
  }, [t, updateViewAttachments]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [atQuery, setAtQuery] = useState<string | null>(null);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      document.documentElement.style.setProperty('--composer-measured-height', `${height}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (editorRef.current?.getText() !== plainText) {
      editorRef.current?.setText(plainText);
    }
    setSlashQuery(null);
    setAtQuery(null);
  }, [editorRef, plainText, viewId]);
  const handleSend = useCallback(() => {
    const text = plainText.trim();
    if (!text && attachments.length === 0) return;
    const readyImages = attachments.filter((a) => a.type === 'image' && a.status === 'ready');
    const pendingImages = attachments.filter((a) => a.type === 'image' && a.status === 'uploading');
    const pendingFiles = attachments.filter((a) => a.type === 'file' && a.status === 'uploading');
    const errorFiles = attachments.filter((a) => a.status === 'error');
    if (pendingImages.length > 0 || pendingFiles.length > 0 || errorFiles.length > 0) return;
    const opts: SendOptions = {};
    const files = attachments.filter((a) => a.type === 'file');
    if (files.length > 0) {
      opts.files = files.map((f) => ({ name: f.name, path: f.path || f.name, size: f.size }));
    }
    let outText = text;
    if (readyImages.length > 0) {
      if (currentModelIsMixin()) {
        const pathLines = readyImages
          .map((f) => f.path && f.path !== f.name ? `[图片: ${f.path}]` : null)
          .filter(Boolean)
          .join('\n');
        if (pathLines) outText = outText ? `${outText}\n\n${pathLines}` : pathLines;
      } else {
        opts.images = readyImages.map((f) => ({ name: f.name, path: f.path || f.name, base64: f.preview! }));
      }
    }
    onSend(outText || '', Object.keys(opts).length > 0 ? opts : undefined);
    editorRef.current?.clear();
    clearAttachments();
    setComposerDraft(viewSessionId, '');
  }, [attachments, clearAttachments, editorRef, onSend, plainText, setComposerDraft, viewSessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleEditorInput = useCallback((text: string) => {
    setComposerDraft(viewSessionId, text);
  }, [setComposerDraft, viewSessionId]);

  const handleSlashTrigger = useCallback((query: string) => {
    setSlashQuery(query);
  }, []);

  const handleSlashDismiss = useCallback(() => {
    setSlashQuery(null);
  }, []);

  const handleCompletionSelect = useCallback((id: string, prompt: string) => {
    editorRef.current?.setSkillChip(id, prompt);
    editorRef.current?.focus();
    setSlashQuery(null);
  }, []);

  const handleAtTrigger = useCallback((query: string) => {
    setAtQuery(query);
  }, []);

  const handleAtDismiss = useCallback(() => {
    setAtQuery(null);
  }, []);

  const handleAtConfirm = useCallback((kind: string, value: string) => {
    // Remove the `@query` text from editor, then insert chip
    const currentText = editorRef.current?.getText() || '';
    const atIdx = currentText.lastIndexOf('@');
    if (atIdx >= 0) {
      editorRef.current?.setText(currentText.slice(0, atIdx));
    }
    editorRef.current?.insertChip(kind, value);
    editorRef.current?.focus();
    setAtQuery(null);
  }, []);

  const handlePasteFiles = useCallback((files: File[]) => {
    ingestFiles(files);
  }, [ingestFiles]);

  const handleSkillSelect = useCallback((id: string, prompt: string) => {
    editorRef.current?.setSkillChip(id, prompt);
    editorRef.current?.focus();
  }, []);

  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], 'clipboard-image.png', { type: imageType });
          ingestFiles([file]);
          return;
        }
      }
    } catch { /* clipboard permission denied — silently ignore */ }
  }, [ingestFiles]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      ingestFiles(e.target.files);
    }
    e.target.value = '';
  }, [ingestFiles]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e.dataTransfer.types)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e.dataTransfer.types)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragDepthRef.current === 0) dragDepthRef.current = 1;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (dragDepthRef.current === 0) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e.dataTransfer.types)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    ingestCandidates(candidatesFromDataTransfer(e.dataTransfer));
  }, [ingestCandidates]);

  // Packaged Tauri windows expose absolute paths through native drag/drop.
  // Keep the DOM handlers above for browser/dev tests; Tauri intercepts native
  // file drops, so the two paths do not process the same event twice.
  useEffect(() => {
    const webview = (window as unknown as {
      __TAURI__?: { webview?: { getCurrentWebview?: () => {
        onDragDropEvent: (handler: (event: { payload: { type: string; paths?: string[] } }) => void) => Promise<() => void>;
      } } };
    }).__TAURI__?.webview?.getCurrentWebview?.();
    if (!webview) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    webview.onDragDropEvent((event) => {
      const kind = event.payload.type;
      if (kind === 'enter' || kind === 'over') {
        setIsDragOver(true);
      } else if (kind === 'leave') {
        setIsDragOver(false);
      } else if (kind === 'drop') {
        setIsDragOver(false);
        if (event.payload.paths?.length) processDroppedPaths(event.payload.paths);
      }
    }).then((cleanup) => {
      if (cancelled) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [processDroppedPaths]);

  const hasContent = plainText.trim().length > 0 || attachments.length > 0;
  const hasBlockingAttachments = attachments.some((a) => a.status !== 'ready');
  const ctaState = computeCTAState(isGenerating, hasContent, hasBlockingAttachments);

  return (
    <div
      ref={composerRef}
      data-slot="composer-root"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && <div data-slot="composer-drop-overlay">{t('upload.dropHint')}</div>}
      <div data-slot="composer-surface">
        {!hideStatusStack && <StatusStack />}
        <AttachmentStrip files={attachments} onRemove={removeAttachment} onRetry={retryAttachment} />
        <CompletionDrawer
          visible={slashQuery !== null}
          query={slashQuery || ''}
          onSelect={handleCompletionSelect}
          onClose={handleSlashDismiss}
        />
        <AtRefPopover
          visible={atQuery !== null}
          query={atQuery || ''}
          onConfirm={handleAtConfirm}
          onClose={handleAtDismiss}
        />
        <div data-slot="composer-input-row">
          <RichEditorInput
            ref={editorRef}
            placeholder={placeholderText}
            disabled={false}
            onInput={handleEditorInput}
            onKeyDown={handleKeyDown}
            onSlashTrigger={handleSlashTrigger}
            onSlashDismiss={handleSlashDismiss}
            onAtTrigger={handleAtTrigger}
            onAtDismiss={handleAtDismiss}
            onPasteFiles={handlePasteFiles}
          />
        </div>
        <div data-slot="composer-toolbar">
          <div data-slot="composer-toolbar-left">
            <ContextMenu
              onUploadFile={handleFileClick}
              onUploadImage={handleImageClick}
              onPasteImage={handlePasteFromClipboard}
            />
            <SkillPanel onSelect={handleSkillSelect} />
          </div>
          <div data-slot="composer-toolbar-right">
            {modelControl === undefined ? <ModelSelector /> : modelControl}
            <PrimaryCTA state={ctaState} onSend={handleSend} onStop={onStop} onQueue={handleSend} />
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}
