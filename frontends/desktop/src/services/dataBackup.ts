import { BRIDGE_BASE } from './constants';

export type BackupSourceMode = 'included' | 'localRepository';

export interface BackupContentCounts {
  memory: number;
  responses: number;
  sessions: number;
}

export interface BackupInspection {
  sourceType: 'backupZip' | 'legacyFolder';
  formatVersion: number | null;
  exportedAt: string | null;
  sourceMode: BackupSourceMode | null;
  content: BackupContentCounts;
}

export interface DataImportResult {
  memoryCopied: number;
  memorySkipped: number;
  responsesCopied: number;
  responsesSkipped: number;
  sessionsAdded: number;
  sessionsSkipped: number;
}

export interface DataExportResult {
  path: string;
  exportedAt: string;
  sourceMode: BackupSourceMode;
  content: BackupContentCounts;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${BRIDGE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
  }
  return data as T;
}

export function backupFilename(lang: string, date = new Date()): string {
  const parts = {
    year: date.getFullYear(),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
    hour: String(date.getHours()).padStart(2, '0'),
    minute: String(date.getMinutes()).padStart(2, '0'),
    second: String(date.getSeconds()).padStart(2, '0'),
  };
  const stamp = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  const label = lang === 'zh' ? '数据备份' : 'data-backup';
  return `GenericAgent-${label}-${stamp}.zip`;
}

export function inspectDataImport(sourcePath: string): Promise<BackupInspection> {
  return postJson('/memory/import/inspect', { sourcePath });
}

export function importData(sourcePath: string): Promise<DataImportResult> {
  return postJson('/memory/import', { sourcePath });
}

export function exportData(
  destinationPath: string,
  sourceMode: BackupSourceMode,
): Promise<DataExportResult> {
  return postJson('/memory/export', { destinationPath, sourceMode });
}
