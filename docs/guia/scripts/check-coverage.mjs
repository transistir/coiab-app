#!/usr/bin/env node
// Offline consistency checks for the guide. Exits 1 and lists every problem
// when something is off; prints "OK: N frames em M páginas" otherwise.
//
//   node scripts/check-coverage.mjs

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guideDir = path.resolve(here, '..');
const repoRoot = path.resolve(guideDir, '..', '..');

const MANIFEST_PATH = path.join(repoRoot, '.rnstorybook', 'capture-manifest.tsv');
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
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split('\t'));
}

async function fileSize(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

// A reference only counts when the reader can actually see it. Drop fenced
// code blocks (``` or ~~~) and HTML comments (<!-- ... -->, including
// multi-line) before looking for image references. Single deterministic pass:
// no regex over the whole document, and an unterminated comment simply drops
// the rest — never a false positive.
export function stripNonRendered(markdown) {
  const visibleLines = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) visibleLines.push(line);
  }

  const text = visibleLines.join('\n');
  let result = '';
  let index = 0;
  while (index < text.length) {
    const commentStart = text.indexOf('<!--', index);
    if (commentStart === -1) {
      result += text.slice(index);
      break;
    }
    result += text.slice(index, commentStart);
    const commentEnd = text.indexOf('-->', commentStart + 4);
    if (commentEnd === -1) break; // unterminated comment: nothing after it renders
    index = commentEnd + 3;
  }
  return result;
}

async function main() {
  const problems = [];

  const pagesConfig = JSON.parse(await readFile(PAGES_PATH, 'utf8'));
  const deferred = new Set(pagesConfig.deferredFlows ?? []);
  const pages = pagesConfig.pages ?? [];

  // No header: flow, story_id, readiness selector, readiness, label.
  // Read the label and readiness from the tail so an extra selector column
  // upstream cannot shift them.
  const manifestRows = parseTsv(await readFile(MANIFEST_PATH, 'utf8')).map((columns) => ({
    flow: columns[0],
    storyId: columns[1],
    readiness: columns[columns.length - 2],
    label: columns[columns.length - 1],
  }));

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
      const manifestRow = manifestByStory.get(storyId);
      if (!manifestRow) {
        problems.push(`pages.json references unknown story_id "${storyId}" (${page.file})`);
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

  // 2. Every frame of a non-deferred flow is covered exactly once.
  const inScope = manifestRows.filter((row) => !deferred.has(row.flow));
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
      problems.push(`page file missing or empty: ${path.relative(repoRoot, pagePath)}`);
      continue;
    }
    const content = stripNonRendered(await readFile(pagePath, 'utf8'));

    for (const storyId of page.stories ?? []) {
      const manifestRow = manifestByStory.get(storyId);
      if (!manifestRow) continue; // already reported above
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

  console.log(`OK: ${coveredFrames} frames em ${pages.length} páginas`);
}

main().catch((error) => {
  console.error(`coverage check failed: ${error.message}`);
  process.exit(1);
});
