// A single in-process job queue, concurrency 1 - never two `claude`
// subprocesses acting on Congress at once. Chat and every Chamber's remote
// run funnel through this same queue: a chat message arriving mid-run queues
// behind it rather than racing it. Deliberately not a library - a
// concurrency-1 FIFO is a five-line primitive.
type QueuedJob = () => Promise<void>;

const queue: QueuedJob[] = [];
let draining = false;

export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await job());
      } catch (err) {
        reject(err);
      }
    });
    void drain();
  });
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) await next();
    }
  } finally {
    draining = false;
  }
}
