import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

// Characterizes #86 against the real `@comapeo/core` 7.4.0 (no emulator): a
// `getProject(id)` that lands inside the `createProject()` registration window
// builds a second `MapeoProject` over the same storage. With on-disk storage
// the two instances race for the same OFD oplog locks and the loser fails with
// ELOCKED through unhandled rejections — the shape that kills the packaged
// backend on device. Root cause and evidence:
// docs/investigation/86-elocked-deeplink.md.
//
// The scenarios themselves live in helpers/core-create-get-race.scenario.mjs
// and run as child processes: they deliberately let rejections go unhandled
// (to record them as the device would see them), which must not pollute the
// jest worker.

const require = createRequire(__filename);

interface ScenarioEvent {
  origin: string;
  code: string | null;
  message: string;
  path: string | null;
}

interface ScenarioReport {
  mode: string;
  node: string;
  fsextLoaded: boolean;
  coreVersion: string;
  bundledCoreVersion: string;
  listedCount: number | null;
  statusAtDiscovery: string | null;
  createPendingAtGet: boolean | null;
  createOutcome: string | null;
  getOutcome: string | null;
  getError: string | null;
  settledGetOutcome: string | null;
  settledGetError: string | null;
  sameInstance: boolean | null;
  waitOutcome: string | null;
  msToFirstElocked: number | null;
  quiesceMs: number | null;
  events: ScenarioEvent[];
  consoleErrors: string[];
  projectDirs: string[];
  coreStorageRoot: string | null;
}

type ScenarioMode = 'ram' | 'disk' | 'disk-serial';

const scenarioPath = path.join(
  __dirname,
  'helpers',
  'core-create-get-race.scenario.mjs',
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runScenario(mode: ScenarioMode): ScenarioReport {
  const result = spawnSync(process.execPath, [scenarioPath, mode], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `scenario ${mode} exited with ${result.status}\n` +
        `--- stdout ---\n${result.stdout}\n` +
        `--- stderr ---\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as ScenarioReport;
}

// The packaged backend (what actually runs on device) must stay pinned to the
// same core version this suite characterizes: a bump of @comapeo/core-react-
// native that changes the bundled core silently invalidates every assertion
// below, and a bump of @comapeo/core alone invalidates what the suite runs.
// V1 pins that version explicitly — the characterization describes 7.4.0 and
// nothing else, so a bump is a re-characterization instruction, not a routine
// expectation mismatch.
const CHARACTERIZED_CORE_VERSION = '7.4.0';

it('runs the same core version the device bundle pins', () => {
  const coreVersion = require('@comapeo/core/package.json').version;
  const coreReactNativeFolder = path.dirname(
    require.resolve('@comapeo/core-react-native/package.json'),
  );
  const bundledPkg = JSON.parse(
    fs.readFileSync(
      path.join(
        coreReactNativeFolder,
        'android/src/main/assets/nodejs-project/package.json',
      ),
      'utf8',
    ),
  );
  const bundledCoreVersion = bundledPkg.dependencies['@comapeo/core'];
  if (
    coreVersion !== CHARACTERIZED_CORE_VERSION ||
    bundledCoreVersion !== CHARACTERIZED_CORE_VERSION
  ) {
    throw new Error(
      `@comapeo/core bump detected: characterized ${CHARACTERIZED_CORE_VERSION}, ` +
        `installed ${coreVersion}, bundled in core-react-native ${bundledCoreVersion}. ` +
        `C1–C3 characterize ${CHARACTERIZED_CORE_VERSION} only and do not transfer ` +
        `to a bump as-is. Before moving the pin: (1) check whether upstream fix ` +
        `D landed (createProject registers its instance earlier, or getProject ` +
        `dedupes on the pending one); (2) if it did, convert this ` +
        `characterization to the invariant form — raced and settled getProject ` +
        `return the SAME instance, zero ELOCKED events on disk — and flip the ` +
        `C1 expectation; (3) re-evaluate mitigation A (deep-link cold start, ` +
        `e10dee12), which only avoids the window's trigger. See ` +
        `docs/investigation/86-elocked-deeplink.md §7.`,
    );
  }
  expect(coreVersion).toBe(CHARACTERIZED_CORE_VERSION);
  expect(bundledCoreVersion).toBe(CHARACTERIZED_CORE_VERSION);
});

// RAM keeps the race (same cache window, same registration overwrite) while
// removing the locks: no events can happen, so this pins the pure
// instance-identity behaviour of the window.
it('ram: the raced getProject lands in the createProject window', () => {
  const report = runScenario('ram');

  // Preconditions: the get really happened inside the window.
  expect(report.fsextLoaded).toBe(true);
  expect(report.listedCount).toBe(1);
  expect(report.statusAtDiscovery).toBe('joining');
  expect(report.createPendingAtGet).toBe(true);
  expect(report.createOutcome).toBe('resolved');
  expect(report.waitOutcome).toBe('met');
  expect(report.events).toEqual([]);
  // Both getProject calls must have actually resolved: a rejected get used to
  // be swallowed and still produced sameInstance: false — a green C1 without
  // two instances ever existing (false green found in review). With these
  // assertions, the characterization below is only reached when both
  // instances were really constructed; the report carries any rejection in
  // getError/settledGetError.
  expect(report.getOutcome).toBe('resolved');
  expect(report.settledGetOutcome).toBe('resolved');

  // Characterization of 7.4.0 today: the raced getProject built a second
  // instance (its :593 registration), and createProject's own instance
  // overwrote it at :525 — so the instances differ. When upstream dedupes or
  // registers during createProject, this flips to true; the precondition
  // assertions above are what make that flip meaningful.
  expect(report.sameInstance).toBe(false);
}, 60_000);

const itOnLinux = process.platform === 'linux' ? it : it.skip;

// The control that must reproduce the device failure: with on-disk storage a
// getProject in the window constructs a second instance over the same cores,
// and every lock the create-side instance already holds surfaces as an
// unhandled rejection — exactly what kills the packaged backend on device.
itOnLinux(
  'disk: the raced getProject opens a second instance over locked oplogs',
  () => {
    const report = runScenario('disk');

    // Preconditions: the race really happened, on real files, in one project.
    expect(report.fsextLoaded).toBe(true);
    expect(report.listedCount).toBe(1);
    expect(report.statusAtDiscovery).toBe('joining');
    expect(report.createPendingAtGet).toBe(true);
    expect(report.waitOutcome).toBe('met');
    expect(report.projectDirs).toHaveLength(1);

    // Characterization of 7.4.0 today: every event that reaches the process is
    // an unhandled rejection carrying ELOCKED on an oplog of the single project
    // — the device failure shape. The blob core's own lock failure never
    // reaches the process as a rejection (the BlobStore listener only
    // console.errors it), so it is absent here by design. Anything outside this
    // allowlist fails, and `createOutcome` is deliberately not asserted: if the
    // create-side instance loses a lock it may hang instead of settle.
    const elocked = report.events.filter(event => event.code === 'ELOCKED');
    expect(elocked.length).toBeGreaterThanOrEqual(1);
    for (const event of report.events) {
      expect(event.origin).toBe('unhandledRejection');
      expect(event.code).toBe('ELOCKED');
      expect(event.path).toMatch(
        new RegExp(`^${escapeRegExp(report.coreStorageRoot ?? '')}/.*/oplog$`),
      );
    }
  },
  120_000,
);

// The negative control that isolates the race as the cause: with on-disk
// storage but no window — create settles before the get — the same project
// opens a second time without a single lock conflict or event, and the cache
// returns the very instance the create built. The observation window is 25s,
// sized from the step-0 disk run (≥ 20× its msToFirstElocked).
itOnLinux(
  'disk-serial: without the race window, the same storage opens cleanly',
  () => {
    const report = runScenario('disk-serial');

    expect(report.fsextLoaded).toBe(true);
    expect(report.createPendingAtGet).toBe(false);
    expect(report.createOutcome).toBe('resolved');
    expect(report.getOutcome).toBe('resolved');
    expect(report.settledGetOutcome).toBe('resolved');
    expect(report.sameInstance).toBe(true);
    expect(report.events).toEqual([]);
    expect(report.consoleErrors).toEqual([]);
  },
  120_000,
);
