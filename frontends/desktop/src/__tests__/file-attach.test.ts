// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { normalizeMessage } from '../lib/normalize-message';

describe('normalizeMessage — files field', () => {
  it('extracts files from raw message', () => {
    const raw = {
      id: 1,
      role: 'user',
      content: 'hello',
      ts: 1000,
      files: [{ name: 'data.csv', path: '/tmp/data.csv', size: 1024 }],
    };
    const msg = normalizeMessage(raw);
    expect(msg.files).toEqual([{ name: 'data.csv', path: '/tmp/data.csv', size: 1024 }]);
  });

  it('handles missing files gracefully', () => {
    const raw = { id: 2, role: 'user', content: 'hi', ts: 2000 };
    const msg = normalizeMessage(raw);
    expect(msg.files).toBeUndefined();
  });

  it('handles empty files array', () => {
    const raw = { id: 3, role: 'user', content: 'hey', ts: 3000, files: [] };
    const msg = normalizeMessage(raw);
    expect(msg.files).toBeUndefined();
  });

  it('preserves images alongside files', () => {
    const raw = {
      id: 4,
      role: 'user',
      content: 'both',
      ts: 4000,
      images: [{ name: 'pic.png', path: '/tmp/pic.png' }],
      files: [{ name: 'doc.pdf', path: '/tmp/doc.pdf', size: 5000 }],
    };
    const msg = normalizeMessage(raw);
    expect(msg.images).toHaveLength(1);
    expect(msg.files).toHaveLength(1);
  });
});
