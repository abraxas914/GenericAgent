import { useCallback } from 'react';
import { ResizeGroup, ResizeItem, ResizeHandler } from '@douyinfe/semi-ui';
import { LeftSidebar } from './LeftSidebar';
import { MainArea } from './MainArea';
import { Statusbar } from './Statusbar';
import { TitlebarControls } from './TitlebarControls';
import { useAppStore } from '../../stores/app';
import './layout.css';

function useDragWindow() {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const tauri = (window as any).__TAURI__;
    tauri?.window?.getCurrentWindow?.()?.startDragging?.();
  }, []);
}

export function AppLayout() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const onDrag = useDragWindow();

  return (
    <div className="ga-app-layout">
      <div className="ga-drag-strip ga-drag-strip--left" aria-hidden="true" onMouseDown={onDrag} />
      <div className="ga-drag-strip ga-drag-strip--main" aria-hidden="true" onMouseDown={onDrag} />
      <TitlebarControls />
      <div className="ga-app-body">
        {sidebarCollapsed ? (
          <div className="ga-body-collapsed">
            <MainArea />
          </div>
        ) : (
          <ResizeGroup direction="horizontal">
            <ResizeItem
              defaultSize="260px"
              min="200px"
              max="340px"
              className="ga-sidebar-item"
            >
              <LeftSidebar />
            </ResizeItem>
            <ResizeHandler />
            <ResizeItem className="ga-main-item">
              <MainArea />
            </ResizeItem>
          </ResizeGroup>
        )}
      </div>
      <Statusbar />
    </div>
  );
}
