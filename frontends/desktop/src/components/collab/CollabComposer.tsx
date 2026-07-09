import { useCallback } from 'react';
import { useConductorStore } from '../../stores/conductor';
import { Composer } from '../chat/Composer';
import type { SendOptions } from '../../stores/chat';

export function CollabComposer() {
  const sendMessage = useConductorStore((s) => s.sendMessage);
  const conductorTyping = useConductorStore((s) => s.conductorTyping);
  const connectionStatus = useConductorStore((s) => s.connectionStatus);

  const handleSend = useCallback((text: string, opts?: SendOptions) => {
    const files = opts?.files?.map((f) => ({ name: f.name, path: f.path }));
    const images = opts?.images?.map((f) => ({ name: f.name, path: f.path, base64: f.base64 }));
    sendMessage(text, files, images);
  }, [sendMessage]);

  const handleStop = useCallback(() => {
    // Conductor doesn't support cancel — noop
  }, []);

  const disabled = connectionStatus !== 'ready';

  return (
    <div className="collab-composer-wrap" data-slot="collab-composer" data-disabled={disabled || undefined}>
      <Composer
        onSend={handleSend}
        onStop={handleStop}
        isGenerating={conductorTyping}
        hideStatusStack
      />
    </div>
  );
}
