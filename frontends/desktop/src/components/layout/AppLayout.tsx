import { ResizeGroup, ResizeItem, ResizeHandler } from '@douyinfe/semi-ui';
import { LeftSidebar } from './LeftSidebar';
import { MainArea } from './MainArea';
import { Statusbar } from './Statusbar';
import { TitlebarControls } from './TitlebarControls';
import { useAppStore } from '../../stores/app';
import './layout.css';

export function AppLayout() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <div className="ga-app-layout">
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
