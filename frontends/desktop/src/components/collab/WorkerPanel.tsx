import { useState, useCallback } from 'react';
import { useConductorStore, type Worker } from '../../stores/conductor';
import { Codicon } from '../../lib/icons';
import { WorkerCard } from './WorkerCard';
import { WorkerDrawer } from './WorkerDrawer';

interface Props {
  onCollapse: () => void;
}

export function WorkerPanel({ onCollapse }: Props) {
  const workers = useConductorStore((s) => s.workers);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);

  const handleCardClick = useCallback((w: Worker) => {
    setSelectedWorker(w);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedWorker(null);
  }, []);

  return (
    <>
      <div className="collab-worker-panel" data-slot="collab-worker-panel">
        <div className="collab-worker-panel-head">
          <span className="collab-worker-panel-title">Agents</span>
          <span className="collab-worker-panel-count">{workers.length}</span>
          <button
            className="collab-panel-collapse-btn"
            onClick={onCollapse}
            aria-label="Hide agents panel"
          >
            <Codicon name="layout-sidebar-right" size="1rem" />
          </button>
        </div>
        {workers.length > 0 ? (
          <div className="collab-worker-list">
            {workers.map((w) => (
              <WorkerCard key={w.id} worker={w} onClick={handleCardClick} />
            ))}
          </div>
        ) : (
          <div className="collab-worker-empty">No agents yet</div>
        )}
      </div>
      {selectedWorker && (
        <WorkerDrawer worker={selectedWorker} onClose={handleCloseDrawer} />
      )}
    </>
  );
}
