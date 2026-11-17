#!/usr/bin/env node
// Offline consistency checks for the guide. Exits 1 and lists every problem
// when something is off; prints "OK: N frames em M páginas" otherwise.
//
//   node scripts/check-coverage.mjs

import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guideDir = path.resolve(here, '..');
const repoRoot = path.resolve(guideDir, '..', '..');

const MANIFEST_PATH = path.join(
  repoRoot,
  '.rnstorybook',
  'capture-manifest.tsv',
);
const PAGES_PATH = path.join(guideDir, 'pages.json');
const CONTENT_DIR = path.join(guideDir, 'src', 'content', 'docs');
const ASSETS_DIR = path.join(guideDir, 'src', 'assets');

function slugify(label) {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseTsv(text) {
  return text
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trim().length > 0)
    .map(line => line.split('\t'));
}

async function fileSize(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

// Returns { char, length, trailing } when the line starts, after optional
// indentation, with a run of three or more backticks or tildes.
function fenceRun(line) {
  let start = 0;
  while (start < line.length && (line[start] === ' ' || line[start] === '\t')) {
    start += 1;
  }
  const char = line[start];
  if (char !== '`' && char !== '~') return null;
  let end = start;
  while (end < line.length && line[end] === char) end += 1;
  if (end - start < 3) return null;
  return {char, length: end - start, trailing: line.slice(end)};
}

// A reference only counts when the reader can actually see it. One pass over
// the lines with two states: an open fence and an open HTML comment. Each
// state is literal for the other one. Inside a fence, "<!--" is content, so a
// stray marker cannot swallow the document; inside a comment, a fence-looking
// line is content, so it cannot open a block and hide later images. Fences and
// comments only open outside both states, and an unterminated comment drops
// the rest — never a false positive.
export function stripNonRendered(markdown) {
  const visibleLines = [];
  let fence = null; // { char, length } of the open fence
  let inComment = false; // never true together with `fence`

  for (const line of markdown.split('\n')) {
    if (fence) {
      // CommonMark: the closing run uses the same character, is at least as
      // long as the opener and has no text after it. A shorter run, or a run
      // followed by text, stays literal content.
      const run = fenceRun(line);
      if (
        run &&
        run.char === fence.char &&
        run.length >= fence.length &&
        run.trailing.trim() === ''
      ) {
        fence = null;
      }
      visibleLines.push('');
      continue;
    }

    let rest = line;
    let rendered = '';
    let openedFence = false;

    while (true) {
      if (inComment) {
        const end = rest.indexOf('-->');
        if (end === -1) break; // still commented: drop the rest of the line
        rest = rest.slice(end + 3);
        inComment = false;
        continue;
      }
      const start = rest.indexOf('<!--');
      if (start === -1) {
        rendered += rest;
        break;
      }
      rendered += rest.slice(0, start);
      // Precedence: a run before the marker opens a fence, so the marker is
      // fence content, not a comment, and the rest of the line is literal.
      const run = fenceRun(rendered);
      if (run) {
        fence = {char: run.char, length: run.length};
        openedFence = true;
        break;
      }
      rest = rest.slice(start + 4);
      const end = rest.indexOf('-->');
      if (end === -1) {
        inComment = true; // continues on the next line
        break;
      }
      rest = rest.slice(end + 3);
    }

    if (openedFence) {
      visibleLines.push('');
      continue;
    }
    if (!inComment) {
      // Text after a closed comment is processed again, so it may open a fence.
      const run = fenceRun(rendered);
      if (run) {
        fence = {char: run.char, length: run.length};
        visibleLines.push('');
        continue;
      }
    }
    visibleLines.push(rendered);
  }

  return visibleLines.join('\n');
}

async function main() {
  const problems = [];

  const pagesConfig = JSON.parse(await readFile(PAGES_PATH, 'utf8'));
  const deferred = new Set(pagesConfig.deferredFlows ?? []);
  const deferredStories = new Set(pagesConfig.deferredStories ?? []);
  const pages = pagesConfig.pages ?? [];

  // No header: flow, story_id, readiness selector, readiness, label.
  // Read the label and readiness from the tail so an extra selector column
  // upstream cannot shift them.
  const manifestRows = parseTsv(await readFile(MANIFEST_PATH, 'utf8')).map(
    columns => ({
      flow: columns[0],
      storyId: columns[1],
      readiness: columns[columns.length - 2],
      label: columns[columns.length - 1],
    }),
  );

  const manifestByStory = new Map();
  for (const row of manifestRows) {
    if (manifestByStory.has(row.storyId)) {
      problems.push(`manifest lists story_id "${row.storyId}" more than once`);
      continue;
    }
    manifestByStory.set(row.storyId, row);
  }

  // 1. Every story_id referenced by pages.json exists in the manifest.
  const seenStories = new Map(); // storyId -> page file(s)
  for (const page of pages) {
    for (const storyId of page.stories ?? []) {
      // A story excluded via deferredStories must not also be listed on a page:
      // that combination means the guide renders a frame the check was told to
      // ignore.
      if (deferredStories.has(storyId)) {
        problems.push(
          `story_id "${storyId}" is listed in deferredStories but also on ${page.file}`,
        );
        continue;
      }
      const manifestRow = manifestByStory.get(storyId);
      if (!manifestRow) {
        problems.push(
          `pages.json references unknown story_id "${storyId}" (${page.file})`,
        );
        continue;
      }
      // 3. No frame may appear twice.
      const previous = seenStories.get(storyId);
      if (previous) {
        problems.push(
          `story_id "${storyId}" is referenced twice: ${previous} and ${page.file}`,
        );
        continue;
      }
      seenStories.set(storyId, page.file);
    }
  }

  // 2. Every frame of a non-deferred flow, outside a deferred story, is
  // covered exactly once.
  const inScope = manifestRows.filter(
    row => !deferred.has(row.flow) && !deferredStories.has(row.storyId),
  );
  for (const row of inScope) {
    if (!seenStories.has(row.storyId)) {
      problems.push(
        `frame not covered by any page: ${row.flow}/${row.storyId} ("${row.label}")`,
      );
    }
  }

  let coveredFrames = 0;

  for (const page of pages) {
    const pagePath = path.join(CONTENT_DIR, page.file);

    // 4. Each page listed in pages.json exists.
    const pageSize = await fileSize(pagePath);
    if (pageSize === null || pageSize === 0) {
      problems.push(
        `page file missing or empty: ${path.relative(repoRoot, pagePath)}`,
      );
      continue;
    }
    const content = stripNonRendered(await readFile(pagePath, 'utf8'));

    for (const storyId of page.stories ?? []) {
      if (deferredStories.has(storyId)) continue; // reported as inconsistent above
      const manifestRow = manifestByStory.get(storyId);
      if (!manifestRow) continue; // reported by the coverage loop above
      const slug = slugify(manifestRow.label);

      // 5. The generated JPEG exists and is not empty.
      const assetPath = path.join(ASSETS_DIR, manifestRow.flow, `${slug}.jpg`);
      const assetSize = await fileSize(assetPath);
      if (assetSize === null || assetSize === 0) {
        problems.push(
          `asset missing or empty: ${path.relative(guideDir, assetPath)} (for ${storyId})`,
        );
      }

      // 6. The markdown references that image.
      const reference = `](../../assets/${manifestRow.flow}/${slug}.jpg)`;
      if (!content.includes(reference)) {
        problems.push(
          `${page.file} does not reference ${reference} (for ${storyId})`,
        );
      }

      coveredFrames += 1;
    }
  }

  if (problems.length > 0) {
    console.error(`coverage check failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const deferredStoryCount = manifestRows.filter(row =>
    deferredStories.has(row.storyId),
  ).length;
  const deferredNote =
    deferredStoryCount === 0
      ? ''
      : ` (${deferredStoryCount} ${
          deferredStoryCount === 1 ? 'story adiada' : 'stories adiadas'
        })`;

  console.log(
    `OK: ${coveredFrames} frames em ${pages.length} páginas${deferredNote}`,
  );
}

main().catch(error => {
  console.error(`coverage check failed: ${error.message}`);
  process.exit(1);
});
