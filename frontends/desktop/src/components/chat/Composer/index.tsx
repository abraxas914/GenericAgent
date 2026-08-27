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
import './composer.css';

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
    if (readyImages.length > 0) {
      opts.images = readyImages.map((f) => ({ name: f.name, path: f.path || f.name, base64: f.preview! }));
    }
    onSend(text || '', Object.keys(opts).length > 0 ? opts : undefined);
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
