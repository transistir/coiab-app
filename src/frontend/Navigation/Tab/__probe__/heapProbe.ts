// THROWAWAY PROBE (chore(ci): probe the tab-suite memory runaway) — not a fix,
// not a test of behaviour. Delete together with the __probe__ directory.
//
// Writes memory marks straight to the real stderr: jest's default (buffered)
// console only flushes when a test file finishes, so an OOM would swallow
// every console.log line. Import this module BEFORE homeTabsHarness: it only
// loads node core modules, so the harness's jest.mock registrations are not
// affected, and its own evaluation is the pre-harness baseline mark.
import * as path from 'node:path';
import * as timers from 'node:timers';
import * as v8 from 'node:v8';
import * as vm from 'node:vm';

const t0 = Date.now();
const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

function resolveGc(): (() => void) | undefined {
  const g = (globalThis as unknown as {gc?: () => void}).gc;
  if (typeof g === 'function') return g;
  try {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc') as () => void;
  } catch {
    return undefined;
  }
}

const gc = resolveGc();

function write(file: string, label: string) {
  const m = process.memoryUsage();
  const parts = [
    '[heap-probe]',
    path.basename(file),
    label,
    `t=${((Date.now() - t0) / 1000).toFixed(1)}s`,
    `heapUsed=${MB(m.heapUsed)}`,
    `heapTotal=${MB(m.heapTotal)}`,
    `rss=${MB(m.rss)}`,
    `external=${MB(m.external)}`,
    `arrayBuffers=${MB(m.arrayBuffers)}`,
    `gc=${gc ? 'yes' : 'no'}`,
  ];
  process.stderr.write(`${parts.join(' ')}\n`);
}

/** Mark now, then (if a gc function could be obtained) again after a full GC. */
export function mark(file: string, label: string) {
  write(file, label);
  if (gc) {
    gc();
    write(file, `${label}+gc`);
  }
}

/**
 * Samples every `ms` on a real, unref'd node timer. If the heap climbs while
 * these samples stop arriving, the event loop is blocked: a synchronous loop
 * (e.g. a render/update loop), not an async leak.
 */
export function startSampler(file: string, ms = 5_000) {
  const id = timers.setInterval(() => write(file, 'sample'), ms);
  id.unref();
  return () => timers.clearInterval(id);
}

write(__filename, 'probe-module-evaluated');
