import { useEffect, useRef, useState, useCallback } from 'react';
import { Modal, Empty, Spin } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import { useServicesStore } from '../../stores/services';

interface Props {
  serviceId: string | null;
  onClose: () => void;
}

const REFRESH_INTERVAL = 3000;

export function ChannelLogModal({ serviceId, onClose }: Props) {
  const { t } = useI18n();
  const fetchLogs = useServicesStore((s) => s.fetchLogs);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLogs = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    const result = await fetchLogs(serviceId);
    setLines(result);
    setLoading(false);
    requestAnimationFrame(() => {
      if (preRef.current) {
        preRef.current.scrollTop = preRef.current.scrollHeight;
      }
    });
  }, [serviceId, fetchLogs]);

  useEffect(() => {
    if (serviceId) {
      loadLogs();
      timerRef.current = setInterval(loadLogs, REFRESH_INTERVAL);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [serviceId, loadLogs]);

  return (
    <Modal
      title={t('modal.channelLogs')}
      visible={serviceId !== null}
      onCancel={onClose}
      footer={null}
      width={870}
      centered
      closeOnEsc
      className="ga-log-dialog"
    >
      {loading && lines.length === 0 ? (
        <div className="ga-services-loading" style={{ padding: 24 }}>
          <Spin />
        </div>
      ) : lines.length === 0 ? (
        <Empty description={t('ch.logEmpty')} style={{ padding: 32 }} />
      ) : (
        <pre ref={preRef} className="ga-log-pre">
          {lines.join('\n')}
        </pre>
      )}
    </Modal>
  );
}
