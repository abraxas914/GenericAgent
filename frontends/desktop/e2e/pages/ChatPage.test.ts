import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatPage native window selection', () => {
  it('switches to the main Tauri window before waiting for its renderer', async () => {
    const order: string[] = [];
    vi.stubGlobal('browser', {
      tauri: {
        switchWindow: vi.fn(async (label: string) => {
          order.push(`switch:${label}`);
        }),
      },
    });

    class TestChatPage extends ChatPage {
      override async waitUntilReady(): Promise<void> {
        order.push('ready');
      }
    }

    await new TestChatPage().switchToMainAndWait();

    expect(order).toEqual(['switch:main', 'ready']);
  });
});
