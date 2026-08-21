import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapFailureCodes, failureMessage } from '../setup/copy';
import { isNewerSnapshot } from '../setup/bootstrap';
import type { BootstrapSnapshot } from '../loading/types';

const root = process.cwd();

function snapshot(seq: number): BootstrapSnapshot {
  return {
    seq,
    mode: 'cold_start',
    phase: 'failed',
    stage: null,
    progress: 0,
    failure: { code: 'unknown', detail: '' },
    diagnostics: {
      buildId: '',
      platform: '',
      projectDir: '',
      pythonPath: '',
      recentLogs: [],
      portState: 'unknown',
      bridgeIdentity: null,
    },
  };
}

describe('setup recovery contracts', () => {
  it('supports every bootstrap failure code', () => {
    expect(bootstrapFailureCodes).toEqual([
      'config_unresolved',
      'prepare_failed',
      'spawn_failed',
      'port_conflict',
      'service_timeout',
      'service_exited',
      'ui_navigation_failed',
      'unknown',
    ]);
  });

  it('falls back to generic recovery copy for future failure codes', () => {
    expect(failureMessage('future_failure', 'en')).toEqual({
      title: 'GenericAgent could not start',
      description: 'Retry. If it continues, copy the diagnostics for troubleshooting.',
    });
  });

  it('rejects stale bootstrap snapshots', () => {
    expect(isNewerSnapshot(4, snapshot(5))).toBe(true);
    expect(isNewerSnapshot(5, snapshot(5))).toBe(false);
    expect(isNewerSnapshot(6, snapshot(5))).toBe(false);
  });

  it('guards setup module failures with replace navigation', () => {
    const html = readFileSync(join(root, 'setup.html'), 'utf8');
    expect(html).toContain("window.addEventListener('error'");
    expect(html).toContain("window.addEventListener('unhandledrejection'");
    expect(html).toContain("location.replace('fallback.html')");
    expect(html).toContain('window.__GA_SETUP_MARK_READY__');
    expect(html).toContain('setTimeout');
  });

  it('keeps fallback independent of React, Semi, and module chunks', () => {
    const html = readFileSync(join(root, 'public', 'fallback.html'), 'utf8');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<script[^>]+type=["']module["']/i);
    expect(html).not.toContain('@douyinfe');
    expect(html).not.toContain('react');
    expect(html).toContain("invoke('get_bootstrap_snapshot')");
    expect(html).toContain("invoke('retry_bootstrap'");
    expect(html).toContain("listen('bootstrap'");
    expect(html).not.toContain("location.replace('setup.html')");
    expect(html).toContain('RoundSquisheen');
    expect(html).toContain('_Ashes_in_the_Snow_');
    expect(html).toContain('help-feedback-label');
  });
});
