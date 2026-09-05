type WsHandler = (payload: unknown) => void;
export type BridgeStatus = 'ready' | 'connecting' | 'offline';

import { WS_URL } from './constants';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;
const listeners = new Map<string, Set<WsHandler>>();

let currentStatus: BridgeStatus = 'offline';
const statusListeners = new Set<(s: BridgeStatus) => void>();

function setStatus(s: BridgeStatus) {
  if (s === currentStatus) return;
  currentStatus = s;
  statusListeners.forEach((fn) => fn(s));
}

export function getBridgeStatus(): BridgeStatus {
  return currentStatus;
}

export function onBridgeStatusChange(fn: (s: BridgeStatus) => void): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

function connect() {
  if (!enabled) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  setStatus('connecting');

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  const socket = ws;
  socket.onopen = () => {
    if (ws !== socket || !enabled) return;
    reconnectAttempt = 0;
    setStatus('ready');
  };

  socket.onmessage = (ev) => {
    if (ws !== socket || !enabled) return;
    try {
      const data = JSON.parse(ev.data);
      const type = data.type as string;
      if (!type) return;
      const handlers = listeners.get(type);
      if (handlers) {
        handlers.forEach((fn) => fn(data));
      }
    } catch {}
  };

  socket.onclose = () => {
    if (ws !== socket || !enabled) return;
    ws = null;
    setStatus('connecting');
    scheduleReconnect();
  };

  socket.onerror = () => {
    if (ws === socket) socket.close();
  };
}

function scheduleReconnect() {
  if (!enabled || reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

export function subscribe(type: string, handler: WsHandler): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(handler);
  return () => {
    listeners.get(type)?.delete(handler);
    if (listeners.get(type)?.size === 0) listeners.delete(type);
  };
}

export function start() {
  enabled = true;
  connect();
}

export function disconnect() {
  enabled = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const socket = ws;
  ws = null;
  socket?.close();
  reconnectAttempt = 0;
  setStatus('offline');
}
