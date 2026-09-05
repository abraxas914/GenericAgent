// A rejected operation must not poison the next one. Each caller still receives
// its own rejection; ordering does not imply retries.
export function serialTask() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}
