import { useCallback, useRef } from 'react';
import { uploadFile } from '../../../services/chat';
import type { AttachmentFile } from '../../../stores/thread-view';

export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface AttachmentCandidate {
  file?: File;
  name?: string;
  isDirectory?: boolean;
}

interface Options {
  t: Translate;
  attachments: AttachmentFile[];
  updateAttachments: (updater: (attachments: AttachmentFile[]) => AttachmentFile[]) => void;
}

interface AttachmentJob {
  id: string;
  file: File;
  isImage: boolean;
}

let attachmentIdCounter = 0;

function nextAttachmentId(): string {
  attachmentIdCounter += 1;
  return `att-${attachmentIdCounter}`;
}

function isPreviewableImage(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('invalid FileReader result'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

function localizedUploadError(prefix: string, error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  if (!detail || detail.toLocaleLowerCase() === prefix.toLocaleLowerCase()) return prefix;
  return `${prefix}: ${detail}`;
}

export function isFileDrag(types: DataTransfer['types'] | readonly string[] | undefined): boolean {
  return Array.from(types || []).includes('Files');
}

type EntryLike = { isDirectory?: boolean; name?: string };
type ItemWithEntry = DataTransferItem & { webkitGetAsEntry?: () => EntryLike | null };

export function candidatesFromDataTransfer(dataTransfer: DataTransfer): AttachmentCandidate[] {
  const files = Array.from(dataTransfer.files || []);
  const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === 'file');
  if (items.length === 0) return files.map((file) => ({ file }));

  const candidates: AttachmentCandidate[] = [];
  items.forEach((item, index) => {
    const entry = (item as ItemWithEntry).webkitGetAsEntry?.();
    const file = item.getAsFile() || files[index];
    if (entry?.isDirectory) {
      candidates.push({ file: file || undefined, name: entry.name || file?.name, isDirectory: true });
    } else if (file) {
      candidates.push({ file });
    }
  });
  return candidates.length > 0 ? candidates : files.map((file) => ({ file }));
}

export function useAttachmentIngestion({ t, attachments, updateAttachments }: Options) {
  const sourcesRef = useRef(new Map<string, File>());
  const attemptsRef = useRef(new Map<string, number>());

  const isCurrent = useCallback((id: string, attempt: number) => (
    sourcesRef.current.has(id) && attemptsRef.current.get(id) === attempt
  ), []);

  const updateCurrent = useCallback((id: string, attempt: number, update: (item: AttachmentFile) => AttachmentFile) => {
    if (!isCurrent(id, attempt)) return;
    updateAttachments((current) => current.map((item) => item.id === id ? update(item) : item));
  }, [isCurrent, updateAttachments]);

  const runJob = useCallback(async ({ id, file, isImage }: AttachmentJob) => {
    const attempt = (attemptsRef.current.get(id) || 0) + 1;
    attemptsRef.current.set(id, attempt);

    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      updateCurrent(id, attempt, (item) => ({
        ...item,
        status: 'error',
        errorMsg: t('upload.readFailed'),
        retryable: true,
      }));
      return;
    }

    if (!isCurrent(id, attempt)) return;

    if (isImage) {
      updateCurrent(id, attempt, (item) => ({
        ...item,
        preview: dataUrl,
        status: 'ready',
        errorMsg: undefined,
        retryable: undefined,
      }));
      return;
    }

    try {
      const serverPath = await uploadFile(file.name, dataUrl);
      updateCurrent(id, attempt, (item) => ({
        ...item,
        path: serverPath,
        status: 'ready',
        errorMsg: undefined,
        retryable: undefined,
      }));
    } catch (error) {
      updateCurrent(id, attempt, (item) => ({
        ...item,
        status: 'error',
        errorMsg: localizedUploadError(t('upload.failed'), error),
        retryable: true,
      }));
    }
  }, [isCurrent, t, updateCurrent]);

  const ingestCandidates = useCallback((candidates: AttachmentCandidate[]) => {
    const next: AttachmentFile[] = [];
    const jobs: AttachmentJob[] = [];

    for (const candidate of candidates) {
      const file = candidate.file;
      const id = nextAttachmentId();
      const name = candidate.name || file?.name || t('file.kindGeneric');
      const isImage = file ? isPreviewableImage(file) : false;
      const base: AttachmentFile = {
        id,
        name,
        size: file?.size || 0,
        type: isImage ? 'image' : 'file',
        status: 'uploading',
        path: name,
      };

      if (candidate.isDirectory) {
        next.push({ ...base, status: 'error', errorMsg: t('upload.folderUnsupported'), retryable: false });
        continue;
      }
      if (!file || file.size === 0) {
        next.push({ ...base, status: 'error', errorMsg: t('upload.empty'), retryable: false });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        next.push({ ...base, status: 'error', errorMsg: t('upload.tooLarge'), retryable: false });
        continue;
      }

      sourcesRef.current.set(id, file);
      next.push(base);
      jobs.push({ id, file, isImage });
    }

    if (next.length === 0) return;
    updateAttachments((current) => [...current, ...next]);
    jobs.forEach((job) => { void runJob(job); });
  }, [runJob, t, updateAttachments]);

  const ingestFiles = useCallback((files: FileList | File[]) => {
    ingestCandidates(Array.from(files).map((file) => ({ file })));
  }, [ingestCandidates]);

  const removeAttachment = useCallback((id: string) => {
    sourcesRef.current.delete(id);
    attemptsRef.current.delete(id);
    updateAttachments((current) => current.filter((item) => item.id !== id));
  }, [updateAttachments]);

  const retryAttachment = useCallback((id: string) => {
    const file = sourcesRef.current.get(id);
    if (!file) return;
    updateAttachments((current) => current.map((item) => item.id === id
      ? { ...item, status: 'uploading', errorMsg: undefined, retryable: undefined }
      : item));
    void runJob({ id, file, isImage: isPreviewableImage(file) });
  }, [runJob, updateAttachments]);

  const clearAttachments = useCallback(() => {
    attachments.forEach(({ id }) => {
      sourcesRef.current.delete(id);
      attemptsRef.current.delete(id);
    });
    updateAttachments(() => []);
  }, [attachments, updateAttachments]);

  return {
    attachments,
    ingestCandidates,
    ingestFiles,
    removeAttachment,
    retryAttachment,
    clearAttachments,
  };
}
