import { IconCopy, IconFile, IconFolderOpen } from '@douyinfe/semi-icons';
import { Banner, Button, Collapse, Typography } from '@douyinfe/semi-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BootstrapFailureCode, BootstrapSnapshot } from '../loading/types';
import {
  getSetupTauri,
  isNewerSnapshot,
  legacyFailureSnapshot,
  loadSetupBootstrap,
  chooseSetupProject,
  chooseSetupPython,
  retrySetupBootstrap,
  type SetupBootstrapMode,
  type SetupValues,
} from './bootstrap';
import { diagnosticsText, failureMessage, setupCopy, setupLanguage } from './copy';

const EMPTY_VALUES: SetupValues = { projectDir: '', pythonPath: '' };

interface SetupLocationFieldProps {
  label: string;
  hint: string;
  value: string;
  emptyText: string;
  buttonText: string;
  buttonLabel: string;
  loading: boolean;
  disabled: boolean;
  icon: ReactNode;
  onChoose: () => void;
}

function SetupLocationField({
  label,
  hint,
  value,
  emptyText,
  buttonText,
  buttonLabel,
  loading,
  disabled,
  icon,
  onChoose,
}: SetupLocationFieldProps) {
  return (
    <section className="ga-setup-location" aria-label={label}>
      <div className="ga-setup-location-header">
        <Typography.Text strong>{label}</Typography.Text>
        <Button
          size="small"
          type="tertiary"
          theme="light"
          icon={icon}
          loading={loading}
          disabled={disabled}
          aria-label={buttonLabel}
          onClick={onChoose}
        >
          {buttonText}
        </Button>
      </div>
      <div
        className={`ga-setup-path${value ? '' : ' ga-setup-path--empty'}`}
        role="textbox"
        aria-readonly="true"
        aria-label={label}
        tabIndex={0}
      >
        {value ? <code>{value}</code> : <span>{emptyText}</span>}
      </div>
      <Typography.Paragraph type="tertiary" size="small" className="ga-setup-location-hint">
        {hint}
      </Typography.Paragraph>
    </section>
  );
}

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
  const valuesRef = useRef<SetupValues>(EMPTY_VALUES);
  const [values, setValues] = useState<SetupValues>(EMPTY_VALUES);
  const [snapshot, setSnapshot] = useState<BootstrapSnapshot | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [selectingProject, setSelectingProject] = useState(false);
  const [selectingPython, setSelectingPython] = useState(false);
  const [pickerStatus, setPickerStatus] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const latestSeq = useRef(-1);
  const snapshotRef = useRef<BootstrapSnapshot | null>(null);
  const bootstrapMode = useRef<SetupBootstrapMode>('snapshot');

  const commitValues = useCallback((next: SetupValues) => {
    valuesRef.current = next;
    setValues(next);
  }, []);

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
      commitValues({ ...valuesRef.current, ...prefill });
    }
  }, [commitValues]);

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
        try {
          const removeListener = await tauri.event.listen('bootstrap', (event) => {
            if (active) renderSnapshot(event.payload);
          });
          if (!active) {
            removeListener();
            return;
          }
          stopListening = removeListener;
        } catch (error) {
          console.warn('[setup] bootstrap events unavailable; using command compatibility mode', error);
        }
      }
      const loaded = await loadSetupBootstrap(tauri.core.invoke, latestSeq.current + 1);
      if (!active) return;
      bootstrapMode.current = loaded.mode;
      const config = loaded.config;
      const configured = { pythonPath: config?.[0] || '', projectDir: config?.[1] || '' };
      commitValues({
        pythonPath: valuesRef.current.pythonPath || configured.pythonPath,
        projectDir: valuesRef.current.projectDir || configured.projectDir,
      });
      renderSnapshot(loaded.snapshot);
    })().catch((error) => {
      if (active) renderSnapshot(syntheticFailure(error, latestSeq.current + 1));
    });
    return () => {
      active = false;
      stopListening?.();
    };
  }, [commitValues, renderSnapshot]);

  const failure = useMemo(
    () => failureMessage(snapshot?.failure?.code as BootstrapFailureCode | undefined, language),
    [language, snapshot?.failure?.code],
  );
  const diagnostics = useMemo(() => diagnosticsText(snapshot), [snapshot]);

  const chooseProject = useCallback(async () => {
    const tauri = getSetupTauri();
    if (!tauri?.core.invoke) {
      setPickerStatus(copy.pickerError);
      return;
    }
    setSelectingProject(true);
    setPickerStatus('');
    try {
      const selected = await chooseSetupProject(
        tauri.core.invoke,
        valuesRef.current.pythonPath,
        copy.projectPickerTitle,
      );
      if (selected) commitValues(selected);
    } catch (error) {
      console.error('[setup] application folder selection failed', error);
      setPickerStatus(copy.pickerError);
    } finally {
      setSelectingProject(false);
    }
  }, [commitValues, copy]);

  const choosePython = useCallback(async () => {
    const tauri = getSetupTauri();
    if (!tauri?.core.invoke) {
      setPickerStatus(copy.pickerError);
      return;
    }
    setSelectingPython(true);
    setPickerStatus('');
    try {
      const pythonPath = await chooseSetupPython(tauri.core.invoke, copy.pythonPickerTitle);
      if (pythonPath) commitValues({ ...valuesRef.current, pythonPath });
    } catch (error) {
      console.error('[setup] Python environment selection failed', error);
      setPickerStatus(copy.pickerError);
    } finally {
      setSelectingPython(false);
    }
  }, [commitValues, copy]);

  const retry = useCallback(async () => {
    const projectDir = valuesRef.current.projectDir.trim();
    const pythonPath = valuesRef.current.pythonPath.trim();
    commitValues({ projectDir, pythonPath });
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
    if (!tauri?.core.invoke) {
      renderSnapshot(syntheticFailure('Tauri bootstrap API is unavailable', latestSeq.current + 1));
      setRetrying(false);
      return;
    }

    const result = await retrySetupBootstrap(
      tauri.core.invoke,
      { pythonPath, projectDir },
      bootstrapMode.current,
    );
    bootstrapMode.current = result.mode;
    if (result.error) {
      if (result.mode === 'legacy') {
        renderSnapshot(legacyFailureSnapshot(
          [pythonPath, projectDir],
          result.error,
          latestSeq.current + 1,
          'spawn_failed',
        ));
      } else {
        const next = await tauri.core.invoke<BootstrapSnapshot>('get_bootstrap_snapshot')
          .catch(() => snapshotRef.current);
        if (next) renderSnapshot(next);
      }
      setRetrying(false);
    }
  }, [commitValues, renderSnapshot]);

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

        <div className="ga-setup-form">
          <SetupLocationField
            label={copy.projectLabel}
            hint={copy.projectHint}
            value={values.projectDir}
            emptyText={copy.projectEmpty}
            buttonText={values.projectDir ? copy.changeProject : copy.chooseProject}
            buttonLabel={copy.projectPickerTitle}
            loading={selectingProject}
            disabled={retrying || selectingPython}
            icon={<IconFolderOpen />}
            onChoose={() => void chooseProject()}
          />
          <SetupLocationField
            label={copy.pythonLabel}
            hint={copy.pythonHint}
            value={values.pythonPath}
            emptyText={copy.pythonEmpty}
            buttonText={values.pythonPath ? copy.changePython : copy.choosePython}
            buttonLabel={copy.pythonPickerTitle}
            loading={selectingPython}
            disabled={retrying || selectingProject}
            icon={<IconFile />}
            onChoose={() => void choosePython()}
          />
          {pickerStatus && (
            <Typography.Text className="ga-setup-picker-status" type="danger" size="small" role="status">
              {pickerStatus}
            </Typography.Text>
          )}
          <Button
            type="primary"
            theme="solid"
            block
            loading={retrying}
            disabled={selectingProject || selectingPython}
            className="ga-setup-retry"
            onClick={() => void retry()}
          >
            {retrying ? copy.retrying : copy.retry}
          </Button>
        </div>

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
          <Collapse.Panel itemKey="help-feedback" header={copy.helpFeedback}>
            <Typography.Paragraph type="tertiary" size="small" className="ga-setup-contact-copy">
              {copy.contact}
            </Typography.Paragraph>
            <div className="ga-setup-contact-ids">
              <code>RoundSquisheen</code>
              <code>_Ashes_in_the_Snow_</code>
            </div>
          </Collapse.Panel>
        </Collapse>
      </section>
    </main>
  );
}
