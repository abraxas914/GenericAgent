import { useLogPolling } from '../../hooks/useLogPolling';
import { Modal, Spin } from '@douyinfe/semi-ui';
import { useI18n } from '../../i18n';
import { useServicesStore } from '../../stores/services';
import { LogTail } from '../log';

interface Props {
  serviceId: string | null;
  onClose: () => void;
}

export function ChannelLogModal({ serviceId, onClose }: Props) {
  const { t } = useI18n();
  const fetchLogs = useServicesStore((s) => s.fetchLogs);
  const lines = useLogPolling(serviceId, fetchLogs);

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
      {lines === null ? (
        <div className="ga-services-loading" style={{ padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <LogTail lines={lines} emptyLabel={t('ch.logEmpty')} className="ga-log-modal-body" />
      )}
    </Modal>
  );
}
