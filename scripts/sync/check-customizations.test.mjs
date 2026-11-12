import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classify,
  matchGlob,
  parseDiff,
  validateRules,
} from './check-customizations.mjs'

test('matchGlob: src/** matches nested paths only below src', () => {
  assert.equal(matchGlob('src/**', 'src/index.ts'), true)
  assert.equal(matchGlob('src/**', 'src/deep/nested/index.ts'), true)
  assert.equal(matchGlob('src/**', 'src'), false)
  assert.equal(matchGlob('src/**', 'other/index.ts'), false)
})

test('matchGlob: src/*.ts stops at directory separators', () => {
  assert.equal(matchGlob('src/*.ts', 'src/index.ts'), true)
  assert.equal(matchGlob('src/*.ts', 'src/deep/index.ts'), false)
  assert.equal(matchGlob('src/*.ts', 'src/index.js'), false)
})

test('matchGlob: src/**/*.test.ts matches any depth, including zero directories', () => {
  assert.equal(matchGlob('src/**/*.test.ts', 'src/a.test.ts'), true)
  assert.equal(matchGlob('src/**/*.test.ts', 'src/deep/nested/a.test.ts'), true)
  assert.equal(matchGlob('src/**/*.test.ts', 'src/deep/a.ts'), false)
  assert.equal(matchGlob('src/**/*.test.ts', 'other/a.test.ts'), false)
})

test('matchGlob: ? matches exactly one non-separator character', () => {
  assert.equal(matchGlob('?', 'a'), true)
  assert.equal(matchGlob('?', 'ab'), false)
  assert.equal(matchGlob('?', '/'), false)
  assert.equal(matchGlob('src/?.ts', 'src/a.ts'), true)
  assert.equal(matchGlob('src/?.ts', 'src/ab.ts'), false)
})

test('validateRules accepts a well-formed rule set', () => {
  const problems = validateRules([
    { id: 'coiab.product', class: 'product', policy: 'reconcile', paths: ['src/**'] },
    { id: 'coiab.fork', class: 'fork-only', policy: 'fork-only', paths: ['src/fork/**'] },
  ])

  assert.deepEqual(problems, [])
})

test('validateRules rejects a rule without id', () => {
  const problems = validateRules([
    { class: 'product', policy: 'reconcile', paths: ['src/**'] },
  ])

  assert.deepEqual(problems.map((problem) => problem.code), ['MISSING_ID'])
})

test('validateRules rejects a rule without class', () => {
  const problems = validateRules([
    { id: 'missing-class', policy: 'reconcile', paths: ['src/**'] },
  ])

  assert.deepEqual(problems.map((problem) => problem.code), ['MISSING_CLASS'])
})

test('validateRules rejects a rule without policy', () => {
  const problems = validateRules([
    { id: 'missing-policy', class: 'product', paths: ['src/**'] },
  ])

  assert.deepEqual(problems.map((problem) => problem.code), ['MISSING_POLICY'])
})

test('validateRules rejects an empty paths array', () => {
  const problems = validateRules([
    { id: 'empty-paths', class: 'product', policy: 'reconcile', paths: [] },
  ])

  assert.deepEqual(problems.map((problem) => problem.code), ['EMPTY_PATHS'])
})

test('validateRules rejects an unknown class', () => {
  const problems = validateRules([
    { id: 'bad-class', class: 'upstream-only', policy: 'reconcile', paths: ['src/**'] },
  ])

  assert.deepEqual(problems.map((problem) => problem.code), ['INVALID_CLASS'])
})

test('validateRules rejects an unknown policy', () => {
  const problems = validateRules([
    { id: 'bad-policy', class: 'product', policy: 'overwrite', paths: ['src/**'] },
  ])

  assert.deepEqual(problems.map((problem) => problem.code), ['INVALID_POLICY'])
})

test('parseDiff decomposes renames into a deletion and an addition', () => {
  const entries = parseDiff(
    [
      'M\tsrc/a.ts',
      'A\tsrc/b.ts',
      'D\tsrc/c.ts',
      'R087\tsrc/old.ts\tsrc/new.ts',
      '',
    ].join('\n'),
  )

  assert.deepEqual(entries, [
    { status: 'M', path: 'src/a.ts' },
    { status: 'A', path: 'src/b.ts' },
    { status: 'D', path: 'src/c.ts' },
    { status: 'D', path: 'src/old.ts' },
    { status: 'A', path: 'src/new.ts' },
  ])
})

const RULES = [
  { id: 'fork', class: 'fork-only', policy: 'fork-only', paths: ['src/fork/**'] },
  { id: 'deleted', class: 'product', policy: 'deleted-here', paths: ['src/deleted/**'] },
  { id: 'product', class: 'product', policy: 'reconcile', paths: ['src/product/**'] },
  { id: 'shared', class: 'shared-infra', policy: 'reconcile', paths: ['src/shared/**'] },
  { id: 'overlap-product', class: 'product', policy: 'reconcile', paths: ['src/overlap.ts'] },
  { id: 'overlap-shared', class: 'shared-infra', policy: 'reconcile', paths: ['src/overlap.ts'] },
]

test('classify counts covered, uncovered and ambiguous paths', () => {
  const entries = [
    { status: 'A', path: 'src/fork/new.ts' },
    { status: 'A', path: 'src/product/new.ts' },
    { status: 'M', path: 'src/product/change.ts' },
    { status: 'D', path: 'src/deleted/gone.ts' },
    { status: 'M', path: 'src/shared/change.ts' },
    { status: 'M', path: 'src/none/mystery.ts' },
    { status: 'M', path: 'src/overlap.ts' },
  ]

  const { summary, problems, files } = classify(entries, RULES)

  assert.deepEqual(summary, { covered: 5, uncovered: 1, ambiguous: 1 })
  assert.deepEqual(
    problems.map((problem) => problem.code).sort(),
    ['AMBIGUOUS', 'UNCOVERED'],
  )

  assert.equal(files.find((file) => file.path === 'src/overlap.ts').result, 'ambiguous')
  assert.deepEqual(
    files.find((file) => file.path === 'src/overlap.ts').classes.sort(),
    ['product', 'shared-infra'],
  )
  assert.equal(files.find((file) => file.path === 'src/none/mystery.ts').result, 'uncovered')
  assert.equal(files.find((file) => file.path === 'src/product/change.ts').result, 'covered')
})

test('classify rejects fork-only paths with status M or D', () => {
  const { problems, summary } = classify(
    [
      { status: 'M', path: 'src/fork/changed.ts' },
      { status: 'D', path: 'src/fork/removed.ts' },
    ],
    [RULES[0]],
  )

  assert.equal(summary.covered, 2)
  assert.equal(
    problems.filter((problem) => problem.code === 'FORK_ONLY_NOT_ADDED').length,
    2,
  )
  assert.equal(
    problems.filter((problem) => problem.code === 'DELETED_NOT_DECLARED').length,
    1,
  )
})

test('classify rejects deleted-here paths with status A or M', () => {
  const { problems, summary } = classify(
    [
      { status: 'A', path: 'src/deleted/back.ts' },
      { status: 'M', path: 'src/deleted/touched.ts' },
    ],
    [RULES[1]],
  )

  assert.equal(summary.covered, 2)
  assert.deepEqual(
    problems.map((problem) => problem.code),
    ['RESURRECTED', 'RESURRECTED'],
  )
})

test('classify rejects a deletion that is not listed in a deleted-here rule', () => {
  const { problems, summary } = classify(
    [{ status: 'D', path: 'src/product/removed.ts' }],
    [RULES[2]],
  )

  assert.equal(summary.covered, 1)
  assert.deepEqual(problems.map((problem) => problem.code), ['DELETED_NOT_DECLARED'])
})

test('classify reports a resurrected deleted-here path', () => {
  const { summary, problems } = classify(
    [{ status: 'A', path: 'src/deleted/still-here.ts' }],
    RULES,
  )

  assert.equal(summary.covered, 1)
  assert.deepEqual(problems.map((problem) => problem.code), ['RESURRECTED'])
  assert.equal(problems[0].path, 'src/deleted/still-here.ts')
})
