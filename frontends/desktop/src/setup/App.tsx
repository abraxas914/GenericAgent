import { IconCopy, IconRefresh } from '@douyinfe/semi-icons';
import { Banner, Button, Collapse, Form, Typography } from '@douyinfe/semi-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BootstrapFailureCode, BootstrapSnapshot } from '../loading/types';
import { getSetupTauri, isNewerSnapshot } from './bootstrap';
import { diagnosticsText, failureMessage, setupCopy, setupLanguage } from './copy';

interface SetupValues {
  projectDir: string;
  pythonPath: string;
}

const EMPTY_VALUES: SetupValues = { projectDir: '', pythonPath: '' };

function syntheticFailure(error: unknown, seq: number): BootstrapSnapshot {
  return {
    seq,
    mode: 'cold_start',
    phase: 'failed',
    stage: null,
    progress: 0,
    failure: { code: 'unknown', detail: String(error) },
    diagnostics: {
      buildId: '',
      platform: navigator.platform || '',
      projectDir: '',
      pythonPath: '',
      portState: 'unknown',
      bridgeIdentity: null,
      recentLogs: [],
    },
  };
}

export function SetupApp() {
  const language = setupLanguage();
  const copy = setupCopy(language);
  const formApiRef = useRef<{ setValues: (values: Partial<SetupValues>) => void } | null>(null);
  const valuesRef = useRef<SetupValues>(EMPTY_VALUES);
  const [values, setValues] = useState<SetupValues>(EMPTY_VALUES);
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const latestSeq = useRef(-1);
  const snapshotRef = useRef<BootstrapSnapshot | null>(null);

  const renderSnapshot = useCallback((next: BootstrapSnapshot) => {
    const previousSnapshot = snapshotRef.current;
    if (!isNewerSnapshot(latestSeq.current, next)) return;
    latestSeq.current = Number.isFinite(next.seq) ? next.seq : latestSeq.current + 1;
    snapshotRef.current = next;
    setSnapshot(next);
    if (next.phase === 'failed') setRetrying(false);
    const prefill: Partial<SetupValues> = {};
    if (next.diagnostics?.projectDir && (!valuesRef.current.projectDir || previousSnapshot?.diagnostics?.projectDir === valuesRef.current.projectDir)) {
      prefill.projectDir = next.diagnostics.projectDir;
    }
    if (next.diagnostics?.pythonPath && (!valuesRef.current.pythonPath || previousSnapshot?.diagnostics?.pythonPath === valuesRef.current.pythonPath)) {
      prefill.pythonPath = next.diagnostics.pythonPath;
    }
    if (Object.keys(prefill).length) {
      valuesRef.current = { ...valuesRef.current, ...prefill };
      setValues(valuesRef.current);
      formApiRef.current?.setValues(prefill);
    }
  }, []);

  useEffect(() => {
    window.__GA_SETUP_MARK_READY__?.();
  }, []);

  useEffect(() => {
    const tauri = getSetupTauri();
    if (!tauri?.core.invoke) {
      renderSnapshot(syntheticFailure('Tauri bootstrap API is unavailable', 0));
      return;
    }

    let active = true;
    let stopListening: (() => void) | undefined;
    void (async () => {
      if (tauri.event?.listen) {
        const removeListener = await tauri.event.listen('bootstrap', (event) => {
          if (active) renderSnapshot(event.payload);
        });
        if (!active) {
          removeListener();
          return;
        }
        stopListening = removeListener;
      }
      const [config, current] = await Promise.all([
        tauri.core.invoke<[string, string]>('get_config').catch(() => ['', '']),
        tauri.core.invoke<BootstrapSnapshot>('get_bootstrap_snapshot'),
      ]);
      if (!active) return;
      const configured = { pythonPath: config?.[0] || '', projectDir: config?.[1] || '' };
      valuesRef.current = {
        pythonPath: valuesRef.current.pythonPath || configured.pythonPath,
        projectDir: valuesRef.current.projectDir || configured.projectDir,
      };
      setValues(valuesRef.current);
      formApiRef.current?.setValues(valuesRef.current);
      renderSnapshot(current);
    })().catch((error) => {
      if (active) renderSnapshot(syntheticFailure(error, latestSeq.current + 1));
    });
    return () => {
      active = false;
      stopListening?.();
    };
  }, [renderSnapshot]);

  const failure = useMemo(
    () => failureMessage(snapshot?.failure?.code as BootstrapFailureCode | undefined, language),
    [language, snapshot?.failure?.code],
  );
  const diagnostics = useMemo(() => diagnosticsText(snapshot), [snapshot]);

  const retry = useCallback(async (submitted: SetupValues) => {
    const projectDir = submitted.projectDir.trim();
    const pythonPath = submitted.pythonPath.trim();
    valuesRef.current = { projectDir, pythonPath };
    setValues(valuesRef.current);
    setCopyStatus('');
    if (!projectDir) {
      const current = snapshotRef.current ?? syntheticFailure('', latestSeq.current + 1);
      renderSnapshot({
        ...current,
        seq: latestSeq.current + 1,
        phase: 'failed',
        failure: { code: 'config_unresolved', detail: '' },
      });
      return;
    }

    setRetrying(true);
    const tauri = getSetupTauri();
    try {
      if (!tauri?.core.invoke) throw new Error('Tauri bootstrap API is unavailable');
      await tauri.core.invoke('retry_bootstrap', { pythonPath, projectDir });
    } catch (_) {
      const next = await tauri?.core.invoke<BootstrapSnapshot>('get_bootstrap_snapshot').catch(() => snapshotRef.current);
      if (next) renderSnapshot(next);
      setRetrying(false);
    }
  }, [renderSnapshot]);

  const copyDiagnostics = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(diagnostics);
      setCopyStatus(copy.copied);
    } catch (_) {
      const element = document.getElementById('diagnostics');
      if (element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.focus();
      }
      setCopyStatus(copy.selectCopy);
    }
  }, [copy, diagnostics]);

  return (
    <main className="ga-setup-page">
      <section className="ga-setup-panel" aria-labelledby="ga-setup-title">
        <header className="ga-setup-header">
          <Typography.Title id="ga-setup-title" heading={3}>{copy.pageTitle}</Typography.Title>
          <Typography.Paragraph type="tertiary">{copy.intro}</Typography.Paragraph>
        </header>

        {snapshot?.failure && (
          <Banner
            className="ga-setup-banner"
            type="danger"
            fullMode={false}
            bordered
            title={failure.title}
            description={failure.description}
            closeIcon={null}
          />
        )}
        {snapshot && !snapshot.failure && retrying && (
          <Banner
            className="ga-setup-banner"
            type="info"
            fullMode={false}
            bordered
            title={copy.retrying}
            description={snapshot.stage || snapshot.phase}
            closeIcon={null}
          />
        )}

        <Form<SetupValues>
          className="ga-setup-form"
          initValues={values}
          getFormApi={(api) => {
            formApiRef.current = api;
          }}
          onValueChange={(next) => {
            valuesRef.current = next;
            setValues(next);
          }}
          onSubmit={(next) => void retry(next)}
          disabled={retrying}
          labelPosition="top"
        >
          <Form.Input
            field="projectDir"
            label={copy.projectLabel}
            extraText={copy.projectHint}
            rules={[{ required: true, message: failureMessage('config_unresolved', language).description }]}
            spellCheck={false}
            autoComplete="off"
          />
          <Form.Input
            field="pythonPath"
            label={copy.pythonLabel}
            extraText={copy.pythonHint}
            spellCheck={false}
            autoComplete="off"
          />
          <Button
            htmlType="submit"
            type="primary"
            theme="solid"
            block
            loading={retrying}
            icon={<IconRefresh />}
            className="ga-setup-retry"
          >
            {retrying ? copy.retrying : copy.retry}
          </Button>
        </Form>

        <Collapse className="ga-setup-diagnostics" accordion>
          <Collapse.Panel itemKey="diagnostics" header={copy.diagnostics}>
            <div className="ga-setup-diagnostics-actions">
              <Button size="small" theme="light" icon={<IconCopy />} onClick={() => void copyDiagnostics()}>
                {copy.copy}
              </Button>
              <Typography.Text type="tertiary" size="small" aria-live="polite">
                {copyStatus}
              </Typography.Text>
            </div>
            <pre id="diagnostics" tabIndex={0}>{diagnostics}</pre>
            <Typography.Paragraph type="tertiary" size="small" className="ga-setup-privacy">
              {copy.privacy}
            </Typography.Paragraph>
          </Collapse.Panel>
        </Collapse>
      </section>
    </main>
  );
}
