import { useState, useEffect } from 'react';
import { Banner, Button, Card, Spin, Typography } from '@douyinfe/semi-ui';
import { IconAlertTriangle, IconRefresh } from '@douyinfe/semi-icons';
import { useBridgeStatus } from '../../hooks/useBridgeStatus';
import { useBridgeEverConnected } from '../../hooks/useBridgeEverConnected';
import { useBridgeFailCount } from '../../hooks/useBridgeFailCount';
import { useI18n } from '../../i18n';
import './connectingOverlay.css';

export function ConnectingOverlay() {
  const { t } = useI18n();
  const bridgeStatus = useBridgeStatus();
  const everConnected = useBridgeEverConnected();
  const failCount = useBridgeFailCount();
  const [fadeOut, setFadeOut] = useState(false);
  const [unmount, setUnmount] = useState(false);

  const shouldShow = !everConnected && bridgeStatus !== 'ready';
  const isOffline = !everConnected && failCount >= 5;

  useEffect(() => {
    if (!shouldShow && !unmount) {
      setFadeOut(true);
      const timer = setTimeout(() => setUnmount(true), 400);
      return () => clearTimeout(timer);
    }
  }, [shouldShow, unmount]);

  if (unmount || everConnected) return null;

  if (isOffline) {
    return (
      <div className="ga-connecting-overlay" role="alert">
        <Card className="ga-connecting-overlay-card" shadows="hover">
          <Banner
            type="danger"
            fullMode={false}
            bordered
            closeIcon={null}
            icon={<IconAlertTriangle />}
            title={t('bridge.offline')}
            description={t('bridge.offlineHint')}
          />
          <Button
            type="primary"
            theme="solid"
            icon={<IconRefresh />}
            onClick={() => window.location.reload()}
          >
            {t('collab.retry')}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div
      className={`ga-connecting-overlay ${fadeOut ? 'ga-connecting-overlay--fade' : ''}`}
      role="status"
      aria-live="polite"
    >
      <Card className="ga-connecting-overlay-content" shadows="hover">
        <Typography.Title heading={4} className="ga-connecting-overlay-brand">
          GenericAgent
        </Typography.Title>
        <Spin size="large" />
        <Typography.Text type="tertiary">{t('bridge.connecting')}</Typography.Text>
      </Card>
    </div>
  );
}
