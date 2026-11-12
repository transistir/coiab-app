#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CLASSES = Object.freeze([
  'fork-only',
  'shared-infra',
  'product',
  'incoming-upstream',
])

export const POLICIES = Object.freeze([
  'preserve-values',
  'reconcile',
  'fork-only',
  'deleted-here',
  'upstream-wins',
  'generated',
  'adopt-or-record',
])

const CLASS_SET = new Set(CLASSES)
const POLICY_SET = new Set(POLICIES)
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g
const GLOB_CACHE = new Map()

/**
 * Translate a repo-relative glob into a regular expression source.
 *
 * - `*` matches anything except a slash
 * - `**` matches anything including a slash; `**` followed by a slash also
 *   matches zero directories
 * - `?` matches exactly one character except a slash
 */
function buildGlobSource(glob) {
  let source = '^'

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]

    if (character === '*') {
      let stars = 1
      while (glob[index + 1] === '*') {
        stars += 1
        index += 1
      }

      if (stars >= 2) {
        if (glob[index + 1] === '/') {
          index += 1
          source += '(?:[^/]+/)*'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
      continue
    }

    if (character === '?') {
      source += '[^/]'
      continue
    }

    source += character.replace(REGEX_SPECIAL, '\\$&')
  }

  source += '$'
  return source
}

function compiledGlob(glob) {
  let expression = GLOB_CACHE.get(glob)
  if (!expression) {
    expression = new RegExp(buildGlobSource(glob))
    GLOB_CACHE.set(glob, expression)
  }
  return expression
}

export function matchGlob(glob, filePath) {
  if (typeof glob !== 'string' || typeof filePath !== 'string') return false
  return compiledGlob(glob).test(filePath)
}

/**
 * Parse `git diff --name-status --find-renames` output.
 *
 * Renames are decomposed into the deletion of the old path and the addition
 * of the new path so every path goes through the same rule classification.
 */
export function parseDiff(output) {
  const entries = []

  for (const rawLine of String(output).split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue

    const fields = line.split('\t')
    const token = fields[0]

    if (token.startsWith('R') || token.startsWith('C')) {
      if (fields.length < 3) {
        throw new Error(`unparseable diff line: ${line}`)
      }
      const oldPath = fields[1]
      const newPath = fields[2]
      if (token.startsWith('R')) {
        entries.push({ status: 'D', path: oldPath })
      }
      entries.push({ status: 'A', path: newPath })
      continue
    }

    if (fields.length < 2) {
      throw new Error(`unparseable diff line: ${line}`)
    }

    const status = token[0]
    const filePath = fields[1]

    if (status === 'A' || status === 'D' || status === 'M') {
      entries.push({ status, path: filePath })
      continue
    }

    // Type changes are content changes for classification purposes.
    if (status === 'T') {
      entries.push({ status: 'M', path: filePath })
      continue
    }

    throw new Error(`unsupported diff status "${token}" for ${filePath}`)
  }

  return entries
}

export function validateRules(rules) {
  if (!Array.isArray(rules)) {
    return [{ code: 'INVALID_RULES', message: 'rules: expected an array' }]
  }

  const problems = []

  rules.forEach((rule, index) => {
    const fallback = `rules[${index}]`

    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      problems.push({ code: 'INVALID_RULE', message: `${fallback}: rule must be an object` })
      return
    }

    const label = typeof rule.id === 'string' && rule.id.trim() ? rule.id : fallback

    if (typeof rule.id !== 'string' || !rule.id.trim()) {
      problems.push({ code: 'MISSING_ID', ruleId: label, message: `${label}: missing or empty "id"` })
    }

    if (typeof rule.class !== 'string' || !rule.class.trim()) {
      problems.push({ code: 'MISSING_CLASS', ruleId: label, message: `${label}: missing or empty "class"` })
    } else if (!CLASS_SET.has(rule.class)) {
      problems.push({ code: 'INVALID_CLASS', ruleId: label, message: `${label}: unknown class "${rule.class}"` })
    }

    if (typeof rule.policy !== 'string' || !rule.policy.trim()) {
      problems.push({ code: 'MISSING_POLICY', ruleId: label, message: `${label}: missing or empty "policy"` })
    } else if (!POLICY_SET.has(rule.policy)) {
      problems.push({ code: 'INVALID_POLICY', ruleId: label, message: `${label}: unknown policy "${rule.policy}"` })
    }

    if (!Array.isArray(rule.paths) || rule.paths.length === 0) {
      problems.push({ code: 'EMPTY_PATHS', ruleId: label, message: `${label}: "paths" must be a non-empty array` })
    } else if (rule.paths.some((glob) => typeof glob !== 'string' || glob.length === 0)) {
      problems.push({ code: 'INVALID_PATHS', ruleId: label, message: `${label}: "paths" must contain only non-empty strings` })
    }
  })

  return problems
}

function usableRules(rules) {
  return (Array.isArray(rules) ? rules : []).filter(
    (rule) =>
      rule &&
      typeof rule === 'object' &&
      Array.isArray(rule.paths) &&
      rule.paths.length > 0 &&
      typeof rule.class === 'string',
  )
}

/**
 * Classify changed paths against the customization rules.
 *
 * A `D` entry is only allowed when a matching rule uses the `deleted-here`
 * policy, and a path matching that policy must not exist in head, so `A` and
 * `M` entries are reported as resurrected deletions.
 */
export function classify(entries, rules) {
  const problems = []
  const files = []
  const matchingRules = usableRules(rules)

  let covered = 0
  let uncovered = 0
  let ambiguous = 0

  for (const entry of Array.isArray(entries) ? entries : []) {
    const { status, path: filePath } = entry
    const matching = matchingRules.filter((rule) => rule.paths.some((glob) => matchGlob(glob, filePath)))

    if (matching.length === 0) {
      uncovered += 1
      files.push({ path: filePath, status, rules: [], classes: [], result: 'uncovered' })
      problems.push({
        code: 'UNCOVERED',
        path: filePath,
        message: `${status} ${filePath}: no rule matches this changed path`,
      })
      continue
    }

    const classes = [...new Set(matching.map((rule) => rule.class))]
    const ruleIds = matching.map((rule) => rule.id)

    if (classes.length > 1) {
      ambiguous += 1
      files.push({ path: filePath, status, rules: ruleIds, classes, result: 'ambiguous' })
      const detail = matching.map((rule) => `${rule.id}=${rule.class}`).join(', ')
      problems.push({
        code: 'AMBIGUOUS',
        path: filePath,
        message: `${status} ${filePath}: matches rules of multiple classes (${detail})`,
      })
      continue
    }

    covered += 1
    files.push({ path: filePath, status, rules: ruleIds, classes, result: 'covered' })

    if (matching.some((rule) => rule.class === 'fork-only') && status !== 'A') {
      problems.push({
        code: 'FORK_ONLY_NOT_ADDED',
        path: filePath,
        message: `${status} ${filePath}: fork-only path must be added (status A)`,
      })
    }

    const deletedHereRules = matching.filter((rule) => rule.policy === 'deleted-here')

    if (deletedHereRules.length > 0 && status !== 'D') {
      problems.push({
        code: 'RESURRECTED',
        path: filePath,
        message: `${status} ${filePath}: deleted-here path still exists in head`,
      })
    }

    if (status === 'D' && deletedHereRules.length === 0) {
      problems.push({
        code: 'DELETED_NOT_DECLARED',
        path: filePath,
        message: `${status} ${filePath}: deleted path is not listed in a deleted-here rule`,
      })
    }
  }

  return {
    summary: { covered, uncovered, ambiguous },
    problems,
    files,
  }
}

function parseArgs(argv) {
  const options = { parent: null, head: null, report: null, json: false, help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--parent' || argument === '--head' || argument === '--report') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      options[argument.slice(2)] = value
      index += 1
      continue
    }

    if (argument === '--json') {
      options.json = true
      continue
    }

    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }

    throw new Error(`unknown argument: ${argument}`)
  }

  return options
}

function usage() {
  return [
    'Usage: node scripts/sync/check-customizations.mjs --parent <sha> --head <sha> [--report <path>] [--json]',
    '',
    'Fails closed unless every path changed between <parent> and <head> is covered by a',
    'rule in .sync/customizations.json and every rule is well formed.',
  ].join('\n')
}

function runGit(args, root) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function gitError(error) {
  const detail = error.stderr || error.stdout || error.message
  return String(detail).trim()
}

function writeReport(root, reportPath, report) {
  const resolved = path.resolve(root, reportPath)
  const relative = path.relative(root, resolved)

  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`--report must point inside the worktree (${root}); got ${reportPath}`)
  }

  mkdirSync(path.dirname(resolved), { recursive: true })
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return resolved
}

function main(argv = process.argv.slice(2)) {
  let options

  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exitCode = 1
    return
  }

  if (options.help) {
    console.log(usage())
    return
  }

  const missing = ['parent', 'head'].filter((key) => !options[key])
  if (missing.length > 0) {
    console.error(`missing required option(s): ${missing.map((key) => `--${key}`).join(', ')}`)
    console.error(usage())
    process.exitCode = 1
    return
  }

  const root = process.cwd()

  let config
  try {
    config = JSON.parse(readFileSync(path.join(root, '.sync', 'customizations.json'), 'utf8'))
  } catch (error) {
    console.error(`cannot read .sync/customizations.json: ${error.message}`)
    process.exitCode = 1
    return
  }

  const rules = config.rules
  const validationProblems = validateRules(rules)

  let entries
  try {
    const diffOutput = runGit(
      ['diff', '--name-status', '--find-renames', options.parent, options.head],
      root,
    )
    entries = parseDiff(diffOutput)
  } catch (error) {
    console.error(`git diff failed: ${gitError(error)}`)
    process.exitCode = 1
    return
  }

  const classification = classify(entries, rules)
  const problems = [...validationProblems, ...classification.problems]
  const report = {
    ok: problems.length === 0,
    parent: options.parent,
    head: options.head,
    summary: classification.summary,
    problems,
    files: classification.files,
  }

  if (options.report) {
    try {
      writeReport(root, options.report, report)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    for (const problem of problems) {
      console.log(problem.message)
    }
    const { covered, uncovered, ambiguous } = classification.summary
    console.log(`covered=${covered} uncovered=${uncovered} ambiguous=${ambiguous}`)
  }

  process.exitCode = report.ok ? 0 : 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main()
}
