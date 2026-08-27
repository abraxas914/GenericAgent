import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Codicon } from '../../lib/icons';
import { isMacOS } from '../../platform';
import { tauriInvoke } from '../../services/bridge';
import { useAppStore } from '../../stores/app';

interface MacosTitlebarMetrics {
  trafficLightCenterY: number;
  trafficLightRightX: number;
}

function validMetrics(value: unknown): value is MacosTitlebarMetrics {
  if (typeof value !== 'object' || value === null) return false;
  const metrics = value as Partial<MacosTitlebarMetrics>;
  return typeof metrics.trafficLightCenterY === 'number'
    && Number.isFinite(metrics.trafficLightCenterY)
    && metrics.trafficLightCenterY >= 0
    && typeof metrics.trafficLightRightX === 'number'
    && Number.isFinite(metrics.trafficLightRightX)
    && metrics.trafficLightRightX >= 0;
}

export function TitlebarControls() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [metrics, setMetrics] = useState<MacosTitlebarMetrics | null>(null);
  const warnedRef = useRef(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  useEffect(() => {
    if (!isMacOS) return;
    let disposed = false;
    let timer: number | undefined;
    const unlisteners: Array<() => void> = [];

    const measure = async () => {
      try {
        const result = await tauriInvoke('get_macos_titlebar_metrics', {});
        if (disposed) return;
        if (!validMetrics(result)) throw new Error('invalid macOS titlebar metrics');
        setMetrics(result);
      } catch (error) {
        if (disposed) return;
        setMetrics(null);
        if (!warnedRef.current) {
          warnedRef.current = true;
          console.warn('Using fallback macOS titlebar geometry', error);
        }
      }
    };
    const scheduleMeasure = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void measure(), 50);
    };

    void measure();
    window.addEventListener('resize', scheduleMeasure);
    const currentWindow = (window as any).__TAURI__?.window?.getCurrentWindow?.();
    for (const subscribe of [currentWindow?.onResized, currentWindow?.onScaleChanged]) {
      if (typeof subscribe !== 'function') continue;
      void Promise.resolve(subscribe.call(currentWindow, scheduleMeasure))
        .then((unlisten) => {
          if (typeof unlisten !== 'function') return;
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', scheduleMeasure);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const positionStyle = metrics ? ({
    '--ga-titlebar-controls-top': `${metrics.trafficLightCenterY - 14}px`,
    '--ga-titlebar-controls-left': `${metrics.trafficLightRightX + 10}px`,
  } as CSSProperties) : undefined;

  return (
    <div
      className="ga-titlebar-controls"
      data-testid="titlebar-controls"
      data-traffic-light-center-y={metrics?.trafficLightCenterY}
      data-traffic-light-right-x={metrics?.trafficLightRightX}
      style={positionStyle}
    >
      <button
        type="button"
        className="ga-titlebar-btn"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏'}
        aria-label={sidebarCollapsed ? '显示侧边栏' : '隐藏侧边栏'}
      >
        <Codicon
          name={sidebarCollapsed ? 'layout-sidebar-left-off' : 'layout-sidebar-left'}
          size="16px"
        />
      </button>
    </div>
  );
}
