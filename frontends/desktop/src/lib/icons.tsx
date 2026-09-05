import icon0 from '@vscode/codicons/src/icons/robot.svg?raw';
import icon1 from '@vscode/codicons/src/icons/symbol-misc.svg?raw';
import icon2 from '@vscode/codicons/src/icons/comment.svg?raw';
import icon3 from '@vscode/codicons/src/icons/files.svg?raw';
import icon4 from '@vscode/codicons/src/icons/graph.svg?raw';
import icon5 from '@vscode/codicons/src/icons/search.svg?raw';
import icon6 from '@vscode/codicons/src/icons/add.svg?raw';
import icon7 from '@vscode/codicons/src/icons/kebab-vertical.svg?raw';
import icon8 from '@vscode/codicons/src/icons/grabber.svg?raw';
import icon9 from '@vscode/codicons/src/icons/arrow-left.svg?raw';
import icon10 from '@vscode/codicons/src/icons/chevron-right.svg?raw';
import icon11 from '@vscode/codicons/src/icons/settings-gear.svg?raw';
import icon12 from '@vscode/codicons/src/icons/server-process.svg?raw';
import icon13 from '@vscode/codicons/src/icons/link.svg?raw';
import icon14 from '@vscode/codicons/src/icons/layout-sidebar-left.svg?raw';
import icon15 from '@vscode/codicons/src/icons/layout-sidebar-left-off.svg?raw';
import icon16 from '@vscode/codicons/src/icons/circle-filled.svg?raw';
import icon17 from '@vscode/codicons/src/icons/layout-sidebar-right.svg?raw';
import icon18 from '@vscode/codicons/src/icons/layout-sidebar-right-off.svg?raw';
import icon19 from '@vscode/codicons/src/icons/pin.svg?raw';
import icon20 from '@vscode/codicons/src/icons/pinned.svg?raw';
import icon21 from '@vscode/codicons/src/icons/edit.svg?raw';
import icon22 from '@vscode/codicons/src/icons/trash.svg?raw';

// Static SVGs from the locked Codicons package; no runtime or user HTML.
const ICONS: Record<string, string> = {
  'robot': icon0,
  'symbol-misc': icon1,
  'comment': icon2,
  'files': icon3,
  'graph': icon4,
  'search': icon5,
  'add': icon6,
  'kebab-vertical': icon7,
  'grabber': icon8,
  'arrow-left': icon9,
  'chevron-right': icon10,
  'settings-gear': icon11,
  'server-process': icon12,
  'link': icon13,
  'layout-sidebar-left': icon14,
  'layout-sidebar-left-off': icon15,
  'circle-filled': icon16,
  'layout-sidebar-right': icon17,
  'layout-sidebar-right-off': icon18,
  'pin': icon19,
  'pinned': icon20,
  'edit': icon21,
  'trash': icon22,
};

export function Codicon({
  name,
  size,
  className,
}: {
  name: string;
  size?: string;
  className?: string;
}) {
  const svg = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : '?';
  return (
    <span
      className={`codicon${className ? ' ' + className : ''}`}
      style={{ fontSize: size, display: 'inline-block', lineHeight: 1 }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
