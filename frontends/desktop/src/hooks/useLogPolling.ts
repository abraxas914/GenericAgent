import { useEffect, useState } from 'react';

export function useLogPolling(id: string | null, read: (id: string) => Promise<string[]>) {
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    let active = true;
    let pending = false;
    setLines(null);
    if (!id) return;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await read(id);
        if (active) setLines(result);
      } catch {
        if (active) setLines([]);
      } finally { pending = false; }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [id, read]);
  return lines;
}
