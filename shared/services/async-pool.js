// Run async work over a list, a few at a time.
//
// Scans that walk a data root read one file after another. Against a local
// folder that is fine; against the server data root each read is a request, so
// a serial loop pays the round trip 3,000 times over (SVG Benchmark's list) and
// takes minutes on a headset. Running a handful at once turns that into a
// fraction of the time without flooding the connection.

export const DEFAULT_CONCURRENCY = 8;

/**
 * Like Promise.all(items.map(fn)) but with at most `limit` in flight.
 * Results keep the order of `items`. A rejection rejects the whole call, as
 * Promise.all does.
 */
export async function mapPool(items, fn, limit = DEFAULT_CONCURRENCY) {
  const list = [...(items || [])];
  const out = new Array(list.length);
  if (!list.length) return out;
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= list.length) return;
      out[index] = await fn(list[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}
