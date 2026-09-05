import { normalizeMessage } from '../lib/normalize-message';
import { BRIDGE_BASE } from './constants';
import { checkedFetch } from './http';

export type MessageStatus = 'completed' | 'in_progress' | 'failed';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  status: MessageStatus;
  createdAt?: number;
  ts?: number;
  turn_segs?: string[];
  images?: { name: string; path: string }[];
  files?: { name: string; path: string; size?: number }[];
  executionMs?: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  untitled: boolean;
  pinned?: boolean;
  status?: 'idle' | 'running' | 'error' | 'cancelled';
  updatedAt?: number | string;
  createdAt?: number | string;
}

export interface PollResult {
  messages: Message[];
  partial?: Message;
  status: 'running' | 'idle';
  hasEarlier?: boolean;
  hasMore?: boolean;
  plan?: unknown;
  model?: { isMixin: boolean; current: string; llmNo?: number; runningLlmNo?: number | null; runningModel?: string | null };
}

function useMock(): boolean {
  return import.meta.env.VITE_MOCK === 'true';
}

// --- Mock state for dev mode ---
let mockMessages: Map<string, Message[]> = new Map();
let mockSessionCounter = 0;
const mockRunning = new Set<string>();

function mockDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- API functions ---



export async function createSession(): Promise<string> {
  if (useMock()) {
    const id = `mock-session-${++mockSessionCounter}`;
    mockMessages.set(id, []);
    return id;
  }
  const res = await checkedFetch(`${BRIDGE_BASE}/session/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: '', mcp_servers: [] }),
  });
  const data = await res.json();
  if (typeof data.sessionId !== 'string' || !data.sessionId) throw new Error('Invalid session response');
  return data.sessionId;
}

async function uploadImage(sessionId: string, name: string, dataUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await checkedFetch(`${BRIDGE_BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dataUrl, sid: sessionId }),
    signal,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'upload failed');
  return data.path;
}

export async function uploadFile(name: string, dataUrl: string): Promise<string> {
  const res = await checkedFetch(`${BRIDGE_BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dataUrl, sid: '_files' }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'upload failed');
  return data.path;
}

export interface DropStat {
  isDir: boolean;
  size: number;
  name: string;
  preview?: string;
}

/**
 * Inspect a path dropped onto the window via Tauri's native drag-drop.
 * Native drops carry absolute paths (not File objects), so the bridge tells us
 * whether the path is a folder or file and — for images when `preview` is set —
 * returns a base64 data URL for the thumbnail. Files/folders otherwise go to the
 * agent by path (read via file_read / os.walk); no bytes cross for them.
 */
export async function statDroppedPath(path: string, preview: boolean): Promise<DropStat | null> {
  try {
    const res = await checkedFetch(`${BRIDGE_BASE}/drop/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, preview }),
    });
    const data = await res.json();
    if (!data.ok) return null;
    return { isDir: !!data.is_dir, size: data.size ?? 0, name: data.name ?? path, preview: data.preview };
  } catch {
    return null;
  }
}

export async function sendPrompt(
  sessionId: string,
  prompt: string,
  files?: { name: string; path: string; size?: number }[],
  images?: { name: string; path: string; base64?: string }[],
  signal?: AbortSignal,
): Promise<string> {
  if (useMock()) {
    const now = Date.now();
    const userMsg: Message = { id: `msg-${now}`, role: 'user', content: prompt, status: 'completed', createdAt: now };
    const msgs = mockMessages.get(sessionId) || [];
    msgs.push(userMsg);
    mockMessages.set(sessionId, msgs);
    mockRunning.add(sessionId);

    setTimeout(() => {
      const ts = Date.now();
      const reply: Message = {
        id: `msg-${ts}`,
        role: 'assistant',
        content: `这是对「${prompt.slice(0, 30)}」的模拟回复。\n\n实际使用时会连接 Python bridge 获取真实 LLM 响应。`,
        status: 'completed',
        createdAt: ts,
      };
      const current = mockMessages.get(sessionId) || [];
      current.push(reply);
      mockMessages.set(sessionId, current);
      mockRunning.delete(sessionId);
    }, 800);

    return userMsg.id;
  }

  const filesMeta = (files || []).map((f) => ({ name: f.name, path: f.path, size: f.size }));

  // Upload images to the bridge so they land under desktop_uploads/, whose files
  // /upload/raw can serve back into the message bubble. Whenever we have base64
  // (paste, file-picker, or a native drop preview) we upload — a raw disk path
  // like C:\Users\... would be rejected by /upload/raw's path whitelist and the
  // thumbnail would break after send. Only fall back to a bare path when there
  // is no base64 to upload (should not happen for real images).
  const imageMetas: { name: string; path: string }[] = [];
  for (const img of images || []) {
    const dataUrl = img.base64 || (img.path?.startsWith('data:') ? img.path : undefined);
    if (dataUrl) {
      const path = await uploadImage(sessionId, img.name, dataUrl, signal);
      imageMetas.push({ name: img.name, path });
    } else if (img.path && !img.path.startsWith('data:') && img.path !== img.name) {
      imageMetas.push({ name: img.name, path: img.path });
    }
  }

  const res = await checkedFetch(`${BRIDGE_BASE}/session/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, prompt, display: prompt, files: filesMeta, imageMetas }),
    signal,
  });
  const data = await res.json();
  if (data.userMessageId == null) throw new Error('Prompt was not accepted');
  return String(data.userMessageId);
}

export async function pollMessages(
  sessionId: string,
  afterId?: string,
  limit: number = 50,
  beforeId?: string,
): Promise<PollResult> {
  if (useMock()) {
    await mockDelay(100);
    const msgs = mockMessages.get(sessionId) || [];
    const afterIdx = afterId ? msgs.findIndex((m) => m.id === afterId) : -1;
    const newMsgs = msgs.slice(afterIdx + 1);
    return { messages: newMsgs, status: mockRunning.has(sessionId) ? 'running' : 'idle' };
  }

  const params = new URLSearchParams({ limit: String(limit) });
  if (afterId) { params.set('after', afterId); params.set('direction', 'forward'); }
  if (beforeId) params.set('before', beforeId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await checkedFetch(`${BRIDGE_BASE}/session/${sessionId}/messages?${params}`, { signal: controller.signal });
    const data = await res.json();
    if (!['running', 'idle', 'error', 'cancelled'].includes(data.status)) throw new Error('Invalid session status');
    return {
      messages: (data.messages || []).map((m: Record<string, unknown>) => normalizeMessage(m)),
      partial: data.partial ? normalizeMessage(data.partial, 'in_progress') : undefined,
      status: data.status === 'running' ? 'running' : 'idle',
      hasEarlier: data.hasEarlier,
      hasMore: data.hasMore,
      plan: data.plan,
      model: data.model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function cancelGeneration(sessionId: string): Promise<void> {
  if (useMock()) return;
  await checkedFetch(`${BRIDGE_BASE}/session/${sessionId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

export async function setSessionModel(
  sessionId: string,
  llmNo: number,
): Promise<{ ok: boolean; llmNo: number; model: { isMixin: boolean; current: string; llmNo?: number; runningLlmNo?: number | null; runningModel?: string | null } }> {
  const res = await checkedFetch(`${BRIDGE_BASE}/session/${sessionId}/model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ llmNo }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Model change failed');
  return data;
}

export async function listSessions(): Promise<SessionInfo[]> {
  if (useMock()) {
    return Array.from(mockMessages.keys()).map((id) => ({
      id,
      title: `Session ${id.split('-').pop()}`,
      untitled: true,
    }));
  }
  const res = await checkedFetch(`${BRIDGE_BASE}/sessions`);
  const data = await res.json();
  const all: SessionInfo[] = data.sessions || [];
  // Filter out conductor worker sessions (tui_ prefix = internal dispatch)
  return all.filter((s) => !s.id.startsWith('tui_'));
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (useMock()) {
    mockMessages.delete(sessionId);
    return;
  }
  await checkedFetch(`${BRIDGE_BASE}/session/${sessionId}`, { method: 'DELETE' });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  if (useMock()) return;
  await checkedFetch(`${BRIDGE_BASE}/session/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function pinSession(sessionId: string, pinned: boolean): Promise<void> {
  if (useMock()) return;
  await checkedFetch(`${BRIDGE_BASE}/session/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  });
}
