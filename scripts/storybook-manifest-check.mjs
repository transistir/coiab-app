#!/usr/bin/env node

// Offline preflight for `.rnstorybook/capture-manifest.tsv` readiness
// targets.
//
// `scripts/storybook-capture-all.sh` gates a capture run on every manifest
// story id resolving against the Storybook index, but it never validates the
// third column — the readiness target each capture waits for. A target the
// app can never satisfy (a route name no longer registered in
// `src/frontend/Navigation/Stack/`, or a testID nothing renders anymore)
// hangs its row until the readiness timeout, minutes into a run. Rows
// `07b` and `08` (the legacy onboarding fork) both shipped as exactly this
// failure class. This script validates every target offline, in seconds:
//
//   route:<Name>   <Name> must be registered as a `RootStack.Screen` in the
//                  navigator sources, and the row's story must seed it —
//                  the readiness marker is
//                  `STORYBOOK.flow-ready.<storyId>.<routeName>`, named
//                  after the container's *current* route by
//                  `withRealNavigator` (a nested seeded state makes the
//                  leaf route the marker name, so it is reported as
//                  ambiguous rather than guessed).
//   testID:<id>    <id> must appear as a literal string in `src/` or
//                  `.rnstorybook/` source.
//
// Anything not provably valid (story id absent from the index, unregistered
// route, story that never names the target route, unknown target kind)
// exits 1 with a per-row verdict table. Run it before dispatching a capture
// workflow; it is the same class of check as the wrapper's story-id gate,
// extended to the target column.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const manifestPath =
  process.argv[2] ?? path.join(repoRoot, '.rnstorybook', 'capture-manifest.tsv');
const configPath = process.argv[3] ?? path.join(repoRoot, '.rnstorybook');

function fail(message) {
  console.error(`storybook-manifest-check: ${message}`);
  process.exitCode = 1;
}

// Runtime story ids are kebab-case: `<kebab title>--<kebab export name>`,
// derived from the export symbol name (a `name:` display override does not
// change the id).
function kebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

const NAVIGATOR_SOURCES = [
  'src/frontend/Navigation/Stack/AppScreens.tsx',
  'src/frontend/Navigation/Stack/OnboardingScreens.tsx',
  'src/frontend/Navigation/Stack/index.tsx',
];

const TESTID_SOURCE_ROOTS = ['src', '.rnstorybook'];
const TESTID_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

// `name="X"` attributes of `RootStack.Screen` elements — the actual screen
// registrations, not the parameter-list declarations.
async function collectRegisteredScreens() {
  const registered = new Map();
  for (const relativePath of NAVIGATOR_SOURCES) {
    const text = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
    for (const match of text.matchAll(/name="([A-Za-z][A-Za-z0-9]*)"/g)) {
      if (!registered.has(match[1])) registered.set(match[1], relativePath);
    }
  }
  return registered;
}

// Route keys declared in `RootStackParamsList` / `OnboardingParamsList`.
// A target that is declared but never registered is a distinct diagnostic:
// the type list and the navigator screen set have drifted (this is how the
// unused `Settings` key reads).
async function collectDeclaredRouteKeys() {
  const text = await fs.readFile(
    path.join(repoRoot, 'src/frontend/sharedTypes/navigation.ts'),
    'utf8',
  );
  const declared = new Set();
  for (const typeName of ['RootStackParamsList', 'OnboardingParamsList']) {
    const blockStart = text.indexOf(`export type ${typeName} = {`);
    if (blockStart === -1) continue;
    let depth = 0;
    let end = blockStart;
    for (; end < text.length; end += 1) {
      if (text[end] === '{') depth += 1;
      else if (text[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    for (const match of text
      .slice(blockStart, end)
      .matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)) {
      declared.add(match[1]);
    }
  }
  return declared;
}

async function collectTestIDSourceText() {
  const chunks = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (TESTID_SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        chunks.push(await fs.readFile(entryPath, 'utf8').catch(() => ''));
      }
    }
  }
  for (const root of TESTID_SOURCE_ROOTS) await walk(path.join(repoRoot, root));
  return chunks.join('\n');
}

// Content of the story's `initialState` payload: the seeded routes object.
// Handles both `initialState: <ident>` (resolved anywhere in the story
// file, spread-built arrays included) and inline
// `initialState: (resolved) => ({...})` factories.
function initialStatePayload(storyFileText, storyBlock) {
  const inlineMatch = /initialState:\s*[({]/.exec(storyBlock);
  if (inlineMatch) {
    const payload = braceMatchedPayload(storyBlock, inlineMatch.index);
    return payload === undefined ? undefined : {text: payload, source: 'inline'};
  }
  const identMatch = /initialState:\s*([A-Za-z][A-Za-z0-9]*)/.exec(storyBlock);
  if (!identMatch) return undefined;
  const definitionMatch = new RegExp(
    `const\\s+${identMatch[1]}\\s*(:[^=]*)?=`,
  ).exec(storyFileText);
  if (!definitionMatch) return undefined;
  const payload = braceMatchedPayload(storyFileText, definitionMatch.index);
  return payload === undefined ? undefined : {text: payload, source: identMatch[1]};
}

// Text from the first `{` at-or-after `startIndex` through its matching `}`.
// String literals in these story files do not contain unbalanced braces;
// if the count goes negative the shape is unexpected and the caller reports
// ambiguity instead of guessing.
function braceMatchedPayload(text, startIndex) {
  const open = text.indexOf('{', startIndex);
  if (open === -1) return undefined;
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return undefined;
}

// The story block for an export: from `export const <Name>: Story =` to the
// next top-level `export const` (or end of file).
function storyBlocks(storyFileText) {
  const blocks = new Map();
  const pattern = /export const ([A-Za-z][A-Za-z0-9]*): Story =/g;
  const starts = [...storyFileText.matchAll(pattern)].map(exportMatch => ({
    name: exportMatch[1],
    index: exportMatch.index,
  }));
  for (const [position, current] of starts.entries()) {
    const next = starts[position + 1];
    blocks.set(
      kebabCase(current.name),
      storyFileText.slice(current.index, next ? next.index : undefined),
    );
  }
  return blocks;
}

async function main() {
  let manifestText;
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return fail(`manifest is not readable: ${manifestPath}`);
  }

  const rows = manifestText
    .split('\n')
    .map((line, index) => ({line: index + 1, fields: line.split('\t')}))
    .filter(row => row.fields.length > 1 || row.fields[0] !== '');
  const malformed = rows.filter(row => row.fields.length !== 5);
  if (malformed.length > 0) {
    return fail(
      `manifest rows must have 5 tab-separated columns; malformed at line(s): ${malformed
        .map(row => row.line)
        .join(', ')}`,
    );
  }

  const {buildIndex} = createRequire(import.meta.url)(
    '@storybook/react-native/node',
  );
  let index;
  try {
    index = await buildIndex({configPath});
  } catch (error) {
    return fail(`could not build the Storybook index: ${error.message}`);
  }

  const [registeredScreens, declaredKeys, testIDCorpus] = await Promise.all([
    collectRegisteredScreens(),
    collectDeclaredRouteKeys(),
    collectTestIDSourceText(),
  ]);

  const storyFileCache = new Map();
  async function storyFileFor(importPath) {
    const absolutePath = path.resolve(repoRoot, importPath);
    let entry = storyFileCache.get(absolutePath);
    if (!entry) {
      const text = await fs.readFile(absolutePath, 'utf8').catch(() => null);
      entry = {text, blocks: text ? storyBlocks(text) : undefined};
      storyFileCache.set(absolutePath, entry);
    }
    return entry;
  }

  let failures = 0;
  for (const {line, fields} of rows) {
    const [flow, storyId, target] = fields;
    let verdict = 'ok';
    let detail = '';

    const indexEntry = index.entries[storyId];
    if (!indexEntry) {
      verdict = 'MISSING_ID';
      detail = 'story id is not in the Storybook index';
    } else if (target.startsWith('route:')) {
      const routeName = target.slice('route:'.length);
      if (!registeredScreens.has(routeName)) {
        verdict = 'UNREGISTERED';
        detail = declaredKeys.has(routeName)
          ? `${routeName} is declared in RootStackParamsList but never registered as a screen`
          : `${routeName} is not registered in ${NAVIGATOR_SOURCES.join(', ')}`;
      } else {
        const storyFile = await storyFileFor(indexEntry.importPath);
        const storyBlock = storyFile.blocks?.get(
          storyId.split('--').pop() ?? '',
        );
        if (!storyBlock) {
          verdict = 'AMBIGUOUS';
          detail = `could not extract the story block for ${storyId} from ${indexEntry.importPath}`;
        } else {
          const initialState = initialStatePayload(storyFile.text, storyBlock);
          if (!initialState) {
            verdict = 'AMBIGUOUS';
            detail =
              'story has no parseable initialState; the readiness route depends on the navigator’s computed initial route';
          } else if (initialState.text.includes('state: {')) {
            verdict = 'AMBIGUOUS';
            detail =
              'seeded state nests a child navigator; the readiness marker follows the leaf route, not this target';
          } else {
            const seededNames = [
              ...initialState.text.matchAll(/name:\s*'([A-Za-z][A-Za-z0-9]*)'/g),
            ].map(nameMatch => nameMatch[1]);
            const activeName = seededNames.at(-1);
            if (activeName === routeName) {
              detail = `registered in ${registeredScreens.get(routeName)}; story’s seeded active route`;
            } else if (seededNames.includes(routeName)) {
              verdict = 'AMBIGUOUS';
              detail = `route is seeded but not the active route (active: ${activeName})`;
            } else {
              verdict = 'UNREACHED';
              detail = `story’s seeded routes never name ${routeName}`;
            }
          }
        }
      }
    } else if (target.startsWith('testID:')) {
      const testId = target.slice('testID:'.length);
      if (!testIDCorpus.includes(testId)) {
        verdict = 'TESTID_ABSENT';
        detail = `${testId} does not appear in src/ or .rnstorybook/ source`;
      }
    } else {
      verdict = 'UNKNOWN_TARGET';
      detail = 'target must be route:<name> or testID:<id>';
    }

    if (verdict !== 'ok') failures += 1;
    console.log(
      `${String(line).padEnd(4)}${flow.padEnd(20)}${storyId.padEnd(44)}${target.padEnd(34)}${verdict.padEnd(16)}${detail}`,
    );
  }

  if (failures > 0) process.exitCode = 1;
  console.log(
    failures === 0
      ? `ALL ${rows.length} ROWS VALID`
      : `${failures} of ${rows.length} row(s) failed`,
  );
}

main().catch(error => fail(error.message));
