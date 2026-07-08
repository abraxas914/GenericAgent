import { memo, useRef, useState, useLayoutEffect } from 'react';
import { matchSkillPrefix } from '../Composer/skills';
import { BRIDGE_BASE } from '../../../services/constants';

function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'c', 'cpp', 'java'].includes(ext)) return '◇';
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) return '{}';
  if (['md', 'txt', 'log', 'csv'].includes(ext)) return '¶';
  if (['pdf'].includes(ext)) return '⊞';
  return '◎';
}

interface Props {
  content: string;
  msgId?: string;
  images?: { name: string; path: string }[];
  files?: { name: string; path: string; size?: number }[];
}

export const UserMessage = memo(function UserMessage({ content, msgId, images, files }: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setClamped(el.scrollHeight > el.clientHeight + 2);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!content && (!images || images.length === 0) && (!files || files.length === 0)) return null;

  const skill = matchSkillPrefix(content);

  return (
    <>
      {images && images.length > 0 && (
        <div data-slot="user-images">
          {images.map((img, i) => (
            <img
              key={i}
              data-slot="user-image-thumb"
              src={img.path.startsWith('data:') ? img.path : `${BRIDGE_BASE}/upload/raw?path=${encodeURIComponent(img.path)}`}
              alt={img.name}
            />
          ))}
        </div>
      )}
      {files && files.length > 0 && (
        <div data-slot="user-files">
          {files.map((f, i) => (
            <div key={i} data-slot="user-file-chip">
              <span data-slot="user-file-icon">{iconForExt(f.name)}</span>
              <span data-slot="user-file-name">{f.name}</span>
              {f.size != null && f.size > 0 && <span data-slot="user-file-size">{fmtSize(f.size)}</span>}
            </div>
          ))}
        </div>
      )}
      <div data-slot="aui_user-message-root" id={msgId ? `msg-${msgId}` : undefined} data-msg-id={msgId || undefined} data-role="user">
        <div data-slot="user-bubble" data-clamped={clamped || undefined}>
          <div ref={textRef} data-slot="user-bubble-text">
            {skill ? (
              <>
                <span className="skill-chip">/{skill.id}</span>
                {skill.rest && <> {skill.rest}</>}
              </>
            ) : (
              content
            )}
          </div>
        </div>
      </div>
    </>
  );
});
