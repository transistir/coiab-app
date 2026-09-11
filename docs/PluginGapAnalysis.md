# Plugin Gap Analysis for post-SPEC factory execution

Plugin-first analysis of the agent factory's four needs — execution, parallel
lanes, multi-agent review, evidence — checking each in the mandated order:
**does a plugin already exist? does configuration resolve it? does
composition resolve it? only then a new plugin.**

(transistir/coiab-app#47.)

**Bottom line: no new plugin is needed for any of the four needs.** Every
need is covered today by a combination of already-installed plugins, native
Claude Code features, and repo skills. What is genuinely missing (Figma
integration for design evidence) is already tracked as coiab-app#53.

## 0. What is actually installed (verified, not assumed)

Enabled plugins relevant to the factory (`~/.claude/settings.json`
`enabledPlugins`, descriptions from each plugin's `plugin.json`):

| Plugin | What it provides |
|--------|------------------|
| `codex@openai-codex` | Codex from Claude Code — code review and task delegation (the `@codex review` PR-comment flow) |
| `review-loop@hamel-review` | "Automated code review loop: Claude implements, Codex reviews independently, Claude addresses feedback" |
| `claude-delegator@jarrodwatts-claude-delegator` | GPT expert subagents via Codex CLI — Architect, Plan Reviewer, Scope Analyst, Code Reviewer, Security |
| `plannotator@plannotator` | Interactive plan review UI (plan markup, team sharing) |
| `autoresearch@autoresearch` | Research sessions with guard hooks (already active here — its dangerous-command block runs on this repo) |
| `mempalace`, `context-mode`, `claude-hud`, `claude-reflect`, `caveman`, `warp` | Memory, context indexing, status line, retrospection, style, terminal — support tooling, not factory stages |

Native Claude Code features in use (no plugin): Agent tool (subagents,
parallel spawn, background), agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
is set), git worktrees, background monitors, the Workflow orchestration tool.

Relevant user-level skills: `senior-junior` (acpx junior agent flow),
`subagent-driven-development`, `senior-engineer-delegation`,
`pr-review-resolver`, `resolve-pr-feedback`, `fetch-pr-unresolved-feedback`,
`writing-plans`, `executing-plans`, `code-review`.

Repo skills: `comapeo-storybook-capture` +
`comapeo-storybook-capture-gate` (UI evidence) — portable layout (real files
in `.agents/skills`, symlinked at `.claude/skills`); and `rebrand-comapeo` —
**Claude-only today**: a real directory under `.claude/skills` with no
`.agents/skills` counterpart, so Codex/Cursor/OpenCode and the other
harness-neutral readers don't see it. Moving it into `.agents/skills` with a
`.claude/skills` symlink is a one-line change when another harness needs it.

## 1. Execution (implementing a work item)

| Order | Answer |
|-------|--------|
| Plugin exists? | Yes — `claude-delegator` (expert delegation), `codex` (task delegation); skills `writing-plans`/`executing-plans`, `senior-junior` |
| Configuration? | Not needed beyond what is enabled |
| Composition? | Main agent implements; delegation plugins handle bounded subtasks |
| New plugin? | **No** |

## 2. Parallel lanes

Answers the issue's first open question directly.

| Order | Answer |
|-------|--------|
| Plugin exists? | Not needed — **native Claude Code covers it**: Agent tool spawns parallel subagents (this session ran 5 concurrent reviewers); background sessions run independent lanes; git worktrees isolate concurrent code changes; the Workflow tool covers deterministic multi-agent orchestration when explicitly requested |
| Configuration? | Teams env already enabled; one worktree per code-touching lane; one branch per issue (already the rule) |
| Composition? | A coordinating session assigns lanes and collects evidence — exactly how PRs #72–#76 ran in parallel in Sprint 1 |
| New plugin? | **No** |

What parallel lanes still lack is **policy, not tooling**: which items may run
concurrently, cost limits, and conflict handling. That is already a separate
issue — coiab-app#48 ("Definir pipeline pós-SPEC: lanes paralelas, custos e
limites") — not a plugin gap.

## 3. Multi-agent review

Answers the issue's second open question directly.

| Order | Answer |
|-------|--------|
| Plugin exists? | Yes — three of them: `codex` (`@codex review` PR comments — used on PRs #72–#76), `review-loop@hamel-review` (implement → Codex reviews → Claude addresses loop), `claude-delegator` (Code Reviewer + Security experts) |
| Configuration? | None — all enabled |
| Composition? | The two-family rule (docs/FactoryProcess.md §1 stage 4, PR #76) = `codex` plugin (family 1) + native Agent-tool Opus subagent (family 2), looped until both are clean. Proven composition: every Sprint 1 PR went through it |
| New plugin? | **No** |

Note on composition choice: `review-loop` drives a local
Claude-implements/Codex-reviews loop; the Sprint 1 flow instead used the
GitHub-native variant (`@codex review` on the PR + review-thread resolution,
supported by the `pr-review-resolver`/`resolve-pr-feedback`/
`fetch-pr-unresolved-feedback` skills) because the human reviewer sees the
whole trail on the PR. Both are installed; the GitHub-native variant is the
one the factory process mandates.

## 4. Evidence

| Order | Answer |
|-------|--------|
| Plugin exists? | No plugin needed — repo skills `comapeo-storybook-capture` (+gate) cover UI evidence via CI; `gh` CLI + Actions artifacts cover builds and run logs |
| Configuration? | Storybook Flow Capture workflow dispatch (wired in CI and proven green on comapeo-mobile-1 during Sprint 1; **on coiab-app the dispatch currently fails at Setup EAS until the `EXPO_TOKEN` secret is set there** — known gap recorded in AGENTS.md, "Coiab CI environment") |
| Composition? | Handoff template from docs/FactoryProcess.md §4 (introduced by #16, PR #76 — open at the time of this review, hence not yet in the tree you are reading) — evidence comment on the issue, screenshots/logs embedded, artifacts linked |
| New plugin? | **No** — with one tracked exception: reading approved designs needs Figma MCP, which is coiab-app#53, not factory infrastructure |

## 5. Recommendation

1. **Build nothing new.** All four needs are met by installed plugins +
   native features + repo skills; Sprint 1 already exercised the full
   composition (parallel lanes, two-family review, evidence handoffs) on
   PRs #72–#76.
2. **Write policy, not plugins**, for what remains open: lane concurrency,
   costs and limits → coiab-app#48.
3. Keep the plugin inventory above as the baseline; re-run this analysis only
   when a factory stage gains a need not in {execution, lanes, review,
   evidence}.
