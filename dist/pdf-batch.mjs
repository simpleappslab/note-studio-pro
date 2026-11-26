import {zipSync} from './vendor/fflate.mjs';

export function archive(outputs) {
  const entries = Object.create(null);
  let size = 0;
  for (const {name, bytes} of outputs) {
    size += bytes.length;
    if (size > 100 * 1024 * 1024) throw Error('ZIP output exceeds 100 MiB.');
    let key = name;
    let suffix = 2;
    while (Object.hasOwn(entries, key)) {
      const dot = name.lastIndexOf('.');
      key = name.slice(0, dot) + '-' + suffix++ + name.slice(dot);
    }
    entries[key] = bytes;
  }
  return zipSync(entries, {level: 0});
}

export async function runBatch(items, concurrency, process, signal, refresh) {
  let next = 0;
  let outputSize = items.reduce((total, item) => total + (item.result?.bytes.length || 0), 0);
  const pending = items.filter(item => item.status !== 'Complete');
  const consume = async () => {
    while (!signal.aborted && next < pending.length) {
      const item = pending[next++];
      item.status = 'Processing';
      refresh();
      try {
        const result = await process(item.file, signal);
        signal.throwIfAborted();
        if (outputSize + result.bytes.length > 100 * 1024 * 1024) throw Error('Batch output exceeds 100 MiB.');
        outputSize += result.bytes.length;
        item.result = result;
        item.status = 'Complete';
      } catch (error) {
        item.status = signal.aborted ? 'Canceled' : 'Failed';
        item.error = signal.aborted ? '' : error.message;
      }
      refresh();
    }
  };
  await Promise.all(Array.from({length: Math.min(2, Math.max(1, concurrency))}, consume));
}
