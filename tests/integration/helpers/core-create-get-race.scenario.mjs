// Reproduction harness for #86: `getProject()` called inside the
// `createProject()` registration window builds a second `MapeoProject` over
// the same storage. In `@comapeo/core` 7.4.0 `createProject` persists the
// project keys (src/mapeo-manager.js:497) — so `listProjects()` sees the
// project immediately — but only registers its instance in `#activeProjects`
// after two awaited writes (:525). A `getProject(id)` in that window misses
// the cache (:557) and constructs a second instance (:583). With on-disk
// storage both instances race for the same `fcntl(F_OFD_SETLK)` oplog locks
// (random-access-file → fs-native-extensions) and the loser fails with
// ELOCKED through an unhandled rejection — the exact shape that kills the
// packaged backend on device.
//
// Usage: node core-create-get-race.scenario.mjs <ram|disk|disk-serial>
//
// - ram: coreStorage in memory. No locks exist, so a second instance opens
//   silently; this pins the registration-overwrite behaviour (sameInstance).
// - disk: real directories, race window. The control that must reproduce the
//   device failure: at least one ELOCKED event, every event an unhandled
//   rejection carrying ELOCKED on an oplog path of the single project.
// - disk-serial: real directories, no race — create settles before get. The
//   negative control: no locks conflict, no events at all.
//
// Prints exactly one JSON object on stdout; everything else goes to stderr.
// Every failure mode is reported in the JSON, never thrown: the caller (the
// jest suite) asserts on the report, so the harness itself must always
// terminate cleanly.

import {createRequire} from 'node:module';
// Node built-ins are imported explicitly rather than taken as globals: this
// helper is a lint-clean standalone entrypoint (the jest suite spawns it).
import console from 'node:console';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';

const require = createRequire(import.meta.url);

const mode = process.argv[2];
if (mode !== 'ram' && mode !== 'disk' && mode !== 'disk-serial') {
  console.error(
    'usage: node core-create-get-race.scenario.mjs <ram|disk|disk-serial>',
  );
  process.exit(2);
}

// Events must carry their origin: the device allowlist is specifically
// "unhandled rejection with code ELOCKED on an oplog path" (docs/investigation
// /86-elocked-deeplink.md §1). The lock error surfaces nested, so walk the
// `cause` chain to find code + path.
function normalizeError(err, origin) {
  let code = null;
  let lockPath = null;
  let node = err;
  for (let depth = 0; depth < 10 && node; depth += 1) {
    if (node.code === 'ELOCKED') {
      code = node.code;
      lockPath = node.path ?? null;
      break;
    }
    if (code === null && node.code !== undefined) code = node.code;
    if (lockPath === null && typeof node.path === 'string')
      lockPath = node.path;
    node = node.cause;
  }
  return {
    origin,
    code,
    message: err instanceof Error ? err.message : String(err),
    path: lockPath,
  };
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

// A settled get carries exactly one key — `value` when it resolved, `error`
// when it rejected. Classify by that key's PRESENCE, never by the truthiness
// of its value: `Promise.reject(undefined)` must be reported as rejected (and
// its reason as errorText(undefined) === "undefined") instead of masquerading
// as a resolved get with a null error (C1 false green, round-3 review).
function classifyResult(result) {
  const rejected = 'error' in result;
  return {
    outcome: rejected ? 'rejected' : 'resolved',
    error: rejected ? errorText(result.error) : null,
  };
}

// Instance identity is only comparable when BOTH getProject calls actually
// resolved to real instances: a rejected get was once conflated with a
// missing instance and made `sameInstance: false` satisfy the ram
// characterization without two instances ever existing (C1 false green,
// review of 22f19ed0). A non-comparable state reports `null` — never `false`
// — so a get that rejected, or resolved without an instance, cannot read as
// "two distinct instances"; the sameInstance assertions in the jest suite
// demand an actual boolean and fail loudly on null instead. The outcome
// fields keep any rejection explicit in the report as well.
function instanceIdentity() {
  if (
    getOutcome !== 'resolved' ||
    settledGetOutcome !== 'resolved' ||
    racedInstance === null ||
    settledInstance === null
  ) {
    return null;
  }
  return racedInstance === settledInstance;
}

// The blob core's ELOCKED never reaches the process as a rejection: the
// BlobStore error listener only console.errors it (mapeo-project.js:425-431).
// Record those separately — informational, asserted by nothing.
const consoleErrors = [];
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  try {
    consoleErrors.push(
      args
        .map(arg => (arg instanceof Error ? `${arg.message}` : String(arg)))
        .join(' '),
    );
  } catch {
    // Stringifying must never break logging itself; fall through to the
    // untouched console.error below either way.
  }
  originalConsoleError(...args);
};

const events = [];
// Arrival timestamps, parallel to `events`: the report derives
// msToFirstElocked from them without leaking them into the event objects.
const eventTimes = [];
const scenarioEpoch = performance.now();
process.on('unhandledRejection', reason => {
  events.push(normalizeError(reason, 'unhandledRejection'));
  eventTimes.push(performance.now() - scenarioEpoch);
});

let fsextLoaded = true;
try {
  require('fs-native-extensions');
} catch {
  fsextLoaded = false;
}

// The core package's exports map hides ./package.json, so resolve the folder
// from the module entry instead of requiring the manifest by subpath.
const corePkgFolder = path.resolve(
  path.dirname(require.resolve('@comapeo/core')),
  '..',
);
const coreVersion = JSON.parse(
  fs.readFileSync(path.join(corePkgFolder, 'package.json'), 'utf8'),
).version;
const coreReactNativePkgFolder = path.dirname(
  require.resolve('@comapeo/core-react-native/package.json'),
);
const bundledNodejsProjectPkg = JSON.parse(
  fs.readFileSync(
    path.join(
      coreReactNativePkgFolder,
      'android/src/main/assets/nodejs-project/package.json',
    ),
    'utf8',
  ),
);
const bundledCoreVersion =
  bundledNodejsProjectPkg.dependencies['@comapeo/core'];

const {MapeoManager} = await import('@comapeo/core');
const {KeyManager} = await import('@mapeo/crypto');
const RAM = (await import('random-access-memory')).default;
const Fastify = (await import('fastify')).default;

const projectMigrationsFolder = path.join(corePkgFolder, 'drizzle/project');
const clientMigrationsFolder = path.join(corePkgFolder, 'drizzle/client');

const onDisk = mode !== 'ram';
const rootDir = onDisk
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'core-create-get-race-'))
  : null;
const dbFolder = onDisk ? path.join(rootDir, 'db') : ':memory:';
const coreStorageRoot = onDisk ? path.join(rootDir, 'core-storage') : null;
if (onDisk) {
  fs.mkdirSync(dbFolder, {recursive: true});
  fs.mkdirSync(coreStorageRoot, {recursive: true});
}

const fastify = Fastify();
const manager = new MapeoManager({
  rootKey: KeyManager.generateRootKey(),
  dbFolder,
  coreStorage: onDisk ? coreStorageRoot : () => new RAM(),
  projectMigrationsFolder,
  clientMigrationsFolder,
  fastify,
});

// Where each ELOCKED lives, relative to the storage root: the first segment is
// the project's own directory, so a single project yields exactly one entry.
function projectDirsFromEvents() {
  if (!onDisk) return [];
  const dirs = new Set();
  for (const event of events) {
    if (!event.path) continue;
    const relative = path.relative(coreStorageRoot, event.path);
    if (relative.startsWith('..')) continue;
    dirs.add(relative.split(path.sep)[0]);
  }
  return [...dirs].sort();
}

async function createOutcomeWithCap(capMs) {
  return Promise.race([
    managerCreatePromise.then(
      () => 'resolved',
      () => 'rejected',
    ),
    sleep(capMs).then(() => 'timeout'),
  ]);
}

const WAIT_UNTIL_MS = 15_000;
const CREATE_CAP_MS = 20_000;
const QUIESCE_QUIET_MS = 500;
const QUIESCE_CAP_MS = 5_000;
// Fixed window for disk-serial. Sized from the step-0 disk run: it must stay
// ≥ 20× the measured msToFirstElocked (1066ms → ≥ 21.3s) to be a meaningful
// negative control.
const SERIAL_WINDOW_MS = 25_000;

async function waitUntil(predicate, timeoutMs) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await predicate()) return 'met';
    await sleep(10);
  }
  return 'deadline';
}

// Wait until no new event has arrived for QUIESCE_QUIET_MS, bounded by
// QUIESCE_CAP_MS, so a slow trickle of rejections still lands in the report.
async function waitForQuiescence() {
  const start = performance.now();
  let seen = events.length;
  let lastNewEventAt = performance.now();
  while (performance.now() - start < QUIESCE_CAP_MS) {
    await sleep(50);
    if (events.length !== seen) {
      seen = events.length;
      lastNewEventAt = performance.now();
      continue;
    }
    if (performance.now() - lastNewEventAt >= QUIESCE_QUIET_MS) break;
  }
  return performance.now() - start;
}

const startedAt = performance.now();
let createSettled = false;
const managerCreatePromise = manager.createProject({name: 'race-proj'});
managerCreatePromise.then(
  () => {
    createSettled = true;
  },
  () => {
    createSettled = true;
  },
);

let createPendingAtGet = null;
let listedCount = null;
let statusAtDiscovery = null;
let discoveredId = null;
let createOutcome = null;
let getOutcome = null;
let getError = null;
let settledGetOutcome = null;
let settledGetError = null;
let sameInstance = null;
let waitOutcome = null;
let quiesceMs = null;
// No initializers: every branch that reads these assigns them first, and an
// unused `= null` is a lint error (no-useless-assignment).
let racedInstance;
let settledInstance;

const discoverDeadline = startedAt + WAIT_UNTIL_MS;
while (performance.now() < discoverDeadline) {
  const projects = await manager.listProjects();
  if (projects.length > 0) {
    listedCount = projects.length;
    statusAtDiscovery = projects[0].status;
    discoveredId = projects[0].projectId;
    break;
  }
  await sleep(5);
}

if (discoveredId === null) {
  waitOutcome = 'deadline';
} else if (mode === 'disk-serial') {
  // Negative control: no race. Create settles fully before the get, so the
  // cache is already populated and the get must return the same instance.
  createOutcome = await createOutcomeWithCap(CREATE_CAP_MS);
  createPendingAtGet = !createSettled;

  const racedResult = await manager.getProject(discoveredId).then(
    value => ({value}),
    error => ({error}),
  );
  ({outcome: getOutcome, error: getError} = classifyResult(racedResult));
  racedInstance = racedResult.value ?? null;

  // Fixed observation window for events that must not happen; sized against
  // the step-0 disk run (SERIAL_WINDOW_MS ≥ 20× its msToFirstElocked).
  const windowStart = performance.now();
  await sleep(SERIAL_WINDOW_MS);
  quiesceMs = Math.round(performance.now() - windowStart);

  const settledResult = await manager.getProject(discoveredId).then(
    value => ({value}),
    error => ({error}),
  );
  ({
    outcome: settledGetOutcome,
    error: settledGetError,
  } = classifyResult(settledResult));
  settledInstance = settledResult.value ?? null;
  sameInstance = instanceIdentity();
} else {
  // The race: get the project in the same tick the id is discovered, before
  // createProject has registered its instance.
  createPendingAtGet = !createSettled;
  const racedPromise = manager.getProject(discoveredId);

  const predicate =
    mode === 'ram'
      ? // In RAM nothing locks, so the only settle worth waiting for is the
        // create itself.
        () => createSettled
      : () => events.some(event => event.code === 'ELOCKED');

  waitOutcome = await waitUntil(predicate, WAIT_UNTIL_MS);
  createOutcome = await createOutcomeWithCap(CREATE_CAP_MS);

  const racedResult = await racedPromise.then(
    value => ({value}),
    error => ({error}),
  );
  ({outcome: getOutcome, error: getError} = classifyResult(racedResult));
  racedInstance = racedResult.value ?? null;

  quiesceMs = await waitForQuiescence();

  const settledResult = await manager.getProject(discoveredId).then(
    value => ({value}),
    error => ({error}),
  );
  ({
    outcome: settledGetOutcome,
    error: settledGetError,
  } = classifyResult(settledResult));
  settledInstance = settledResult.value ?? null;
  sameInstance = instanceIdentity();
}

const firstElockedIndex = events.findIndex(event => event.code === 'ELOCKED');
const msToFirstElocked =
  firstElockedIndex === -1 ? null : Math.round(eventTimes[firstElockedIndex]);

const report = {
  mode,
  node: process.version,
  fsextLoaded,
  coreVersion,
  bundledCoreVersion,
  listedCount,
  statusAtDiscovery,
  createPendingAtGet,
  createOutcome,
  getOutcome,
  getError,
  settledGetOutcome,
  settledGetError,
  sameInstance,
  waitOutcome,
  msToFirstElocked,
  quiesceMs: quiesceMs === null ? null : Math.round(quiesceMs),
  events,
  consoleErrors,
  projectDirs: projectDirsFromEvents(),
  coreStorageRoot,
};

console.log(JSON.stringify(report, null, 2));

// Best-effort teardown, after the report is out: a broken instance can make
// close() reject or hang, and none of that may lose the report.
await Promise.race([manager.close().catch(() => {}), sleep(5_000)]);
if (rootDir !== null) {
  try {
    fs.rmSync(rootDir, {recursive: true, force: true, maxRetries: 3});
  } catch {
    // A leftover temp dir must not turn a printed report into a crash.
  }
}
process.exit(0);
