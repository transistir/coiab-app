#!/usr/bin/env node
// Builds the guide's image assets from a Storybook capture run.
//
//   node scripts/build-assets.mjs --captures <dir> [--out <dir>]
//
// <dir> must contain captures.tsv (with header) plus the per-flow PNG folders.
// Frames are only produced for flows that are in the manifest and not listed in
// pages.json -> deferredFlows.

import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const GUIDE_WIDTH = 720;
const JPEG_QUALITY = 82;

const here = path.dirname(fileURLToPath(import.meta.url));
const guideDir = path.resolve(here, '..');
const repoRoot = path.resolve(guideDir, '..', '..');

const MANIFEST_PATH = path.join(repoRoot, '.rnstorybook', 'capture-manifest.tsv');
const PAGES_PATH = path.join(guideDir, 'pages.json');

const CAPTURES_HEADER = [
  'position',
  'flow',
  'story_id',
  'label',
  'relative_png_path',
  'byte_size',
];

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error('Usage: node scripts/build-assets.mjs --captures <dir> [--out <dir>]');
  process.exit(1);
}

function parseArgs(argv) {
  const args = { captures: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--captures') {
      args.captures = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--out') {
      args.out = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      usage();
    } else {
      usage(`unknown argument: ${arg}`);
    }
  }
  if (!args.captures) usage('--captures <dir> is required');
  return args;
}

// Lowercase, strip accents, collapse anything outside [a-z0-9] into a single
// dash, then trim leading/trailing dashes.
export function slugify(label) {
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

async function readManifest() {
  const rows = parseTsv(await readFile(MANIFEST_PATH, 'utf8'));
  // No header: flow, story_id, readiness selector, readiness, label.
  // The label is the last column and the readiness the one before it, so an
  // extra selector column upstream does not shift the values we care about.
  return rows.map((columns, index) => {
    const [flow, storyId] = columns;
    const label = columns[columns.length - 1];
    const readiness = columns[columns.length - 2];
    if (!flow || !storyId || !label || columns.length < 4) {
      throw new Error(
        `malformed manifest row at line ${index + 1}: ${JSON.stringify(columns)}`,
      );
    }
    return { flow, storyId, readiness, label };
  });
}

async function readCaptures(capturesDir) {
  const tsvPath = path.join(capturesDir, 'captures.tsv');
  let text;
  try {
    text = await readFile(tsvPath, 'utf8');
  } catch {
    throw new Error(`captures.tsv not found in ${capturesDir}`);
  }

  const rows = parseTsv(text);
  if (rows.length === 0) throw new Error(`${tsvPath} is empty`);

  const header = rows[0];
  if (header.join(',') !== CAPTURES_HEADER.join(',')) {
    throw new Error(
      `${tsvPath} header mismatch.\n  expected: ${CAPTURES_HEADER.join('\t')}\n  actual:   ${header.join('\t')}`,
    );
  }

  return rows.slice(1).map((columns, index) => {
    if (columns.length !== CAPTURES_HEADER.length) {
      throw new Error(
        `${tsvPath} line ${index + 2} has ${columns.length} columns, expected ${CAPTURES_HEADER.length}`,
      );
    }
    const [position, flow, storyId, label, relativePngPath, byteSize] = columns;
    return { position, flow, storyId, label, relativePngPath, byteSize: Number(byteSize) };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const capturesDir = path.resolve(process.cwd(), args.captures);
  const outDir = path.resolve(process.cwd(), args.out ?? path.join(guideDir, 'src', 'assets'));

  const pages = JSON.parse(await readFile(PAGES_PATH, 'utf8'));
  const deferred = new Set(pages.deferredFlows ?? []);

  const manifest = await readManifest();
  const captures = await readCaptures(capturesDir);

  const problems = [];

  const inScope = manifest.filter((row) => !deferred.has(row.flow));

  const capturesByStory = new Map();
  for (const row of captures) {
    const existing = capturesByStory.get(row.storyId);
    if (existing) {
      problems.push(
        `story_id "${row.storyId}" appears more than once in captures.tsv (positions ${existing.position} and ${row.position})`,
      );
      continue;
    }
    capturesByStory.set(row.storyId, row);
  }

  // The capture run must have the same number of frames per flow as the manifest,
  // otherwise a frame silently went missing (or extra frames landed) upstream.
  const flows = [...new Set(inScope.map((row) => row.flow))];
  for (const flow of flows) {
    const expected = inScope.filter((row) => row.flow === flow).length;
    const found = captures.filter((row) => row.flow === flow).length;
    if (expected !== found) {
      problems.push(
        `frame count for flow "${flow}" diverges: manifest has ${expected}, captures.tsv has ${found}`,
      );
    }
  }

  const written = [];
  for (const row of inScope) {
    const capture = capturesByStory.get(row.storyId);
    if (!capture) {
      problems.push(`manifest story "${row.storyId}" (${row.flow}) is missing from captures.tsv`);
      continue;
    }

    const pngPath = path.join(capturesDir, capture.relativePngPath);
    try {
      const info = await stat(pngPath);
      if (!info.isFile() || info.size === 0) {
        problems.push(`PNG for "${row.storyId}" is empty or not a file: ${pngPath}`);
        continue;
      }
    } catch {
      problems.push(`PNG for "${row.storyId}" is missing: ${pngPath}`);
      continue;
    }

    const slug = slugify(row.label);
    if (!slug) {
      problems.push(`label "${row.label}" (${row.storyId}) produces an empty slug`);
      continue;
    }

    // The manifest is the naming authority: the frame's slug comes from the
    // manifest label, never from captures.tsv. A capture produced before a
    // label rename would otherwise write a filename that check-coverage.mjs
    // never looks for — a silent orphan. Refuse the divergence instead.
    if (capture.label !== row.label) {
      problems.push(
        `label mismatch for story_id "${row.storyId}": manifest has "${row.label}", captures.tsv has "${capture.label}" — update the manifest or recapture before building assets`,
      );
      continue;
    }

    const targetDir = path.join(outDir, row.flow);
    const targetPath = path.join(targetDir, `${slug}.jpg`);

    try {
      await mkdir(targetDir, { recursive: true });
      await sharp(pngPath)
        .resize({ width: GUIDE_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(targetPath);
      const { width, height } = await sharp(targetPath).metadata();
      const size = (await stat(targetPath)).size;
      written.push({ flow: row.flow, slug, path: targetPath, width, height, size });
    } catch (error) {
      problems.push(`failed to process "${row.storyId}": ${error.message}`);
    }
  }

  if (problems.length > 0) {
    console.error(`build-assets: ${problems.length} problem(s) found:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const counts = new Map();
  for (const item of written) counts.set(item.flow, (counts.get(item.flow) ?? 0) + 1);

  const sample = written[0];
  const totalBytes = written.reduce((sum, item) => sum + item.size, 0);

  console.log(`frames: ${written.length}`);
  for (const [flow, count] of counts) console.log(`  ${flow}: ${count}`);
  if (sample) {
    console.log(`sample: ${path.relative(outDir, sample.path)} ${sample.width}x${sample.height}`);
  }
  console.log(`bytes written: ${totalBytes}`);
  console.log(`output: ${outDir}`);
}

main().catch((error) => {
  console.error(`build-assets: ${error.message}`);
  process.exit(1);
});
