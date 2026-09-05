// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createSession, deleteSession, pollMessages, sendPrompt, setSessionModel } from '../services/chat';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([409, 404, 500])('propagates HTTP %s through actual chat operations', async (status) => {
  vi.stubEnv('VITE_MOCK', 'false');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'server refused' }), { status })));
  for (const operation of [
    () => createSession(), () => sendPrompt('s', 'hello'), () => pollMessages('s'),
    () => setSessionModel('s', 2), () => deleteSession('s'),
  ]) await expect(operation()).rejects.toThrow('server refused');
});

it('does not treat a malformed accepted response as a sent message', async () => {
  vi.stubEnv('VITE_MOCK', 'false');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  await expect(sendPrompt('s', 'hello')).rejects.toThrow('not accepted');
});
