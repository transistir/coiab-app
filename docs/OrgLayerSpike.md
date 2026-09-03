# Organization Layer Spike — Verdict

Spike for representing an Organization as a **frontend product layer over two
ordinary CoMapeo projects** (transistir/coiab-app#46), per
`docs/specs/SPEC-46-organizacao-camada-produto.md` (committed in PR
transistir/comapeo-mobile-1#76 — open at the time of this writing). This
document is the verdict; the
executable evidence is `tests/integration/spike-organization.test.ts`, which
drives `@comapeo/core` directly with two in-process devices connected through
a real local-peer connection path — explicit `connectLocalPeer`, not mDNS
discovery (and, for E8, a real `@comapeo/cloud` server in a child process).

## Verdict: FRONTEND_ONLY_VIABLE

All eight mandatory experiments pass with **zero changes to `@comapeo/core`**
(with one scoped exception: E7's sender-half scenario is not simulated — the
pass there covers receiver-side acceptance recovery and create-side
interruption only; see *What the spike does not cover*).
An Organization is nothing more than a composition of two projects correlated
by a marker stored in `projectDescription`:

```
coiab-org:v1:<organizationId>:m   (Monitoramento)
coiab-org:v1:<organizationId>:a   (Alertas)
```

Everything the product layer needs — creation, reconstruction after restart,
invite fan-out, bundle acceptance, partial-failure recovery, remote-archive
fan-out — is expressible with existing per-project APIs.

## Experiment results (SPEC section 14)

| # | Experiment | Result | Proven by |
|---|------------|--------|-----------|
| E1 | Create + reconstruct after restart | ✅ Pass | Two projects with markers, manager closed and recreated over the same folders, both project IDs reconstructed under the same `organizationId` from `listProjects()` + `$getProjectSettings()` alone. Also: a one-slot org reconstructs as `incomplete`, never `ready`. |
| E2 | Switch between the two projects | ✅ Pass (core half) | Both slots usable through the plain per-project API in either order. Nothing in core changes to "switch" — `activeProjectId` is app state and is not exercised here (see *Not covered*). |
| E3 | Marker round-trip | ✅ Pass | Marker readable locally before invite, visible in the pending invite **before** accept (it travels in the invite's `projectDescription`), and readable from the receiver's own synced `projectSettings` after accept — the post-sync source reconstruction consumes. `createProject({projectDescription: marker})` (~51 chars) passes schema validation. |
| E4 | One action sends both invites | ✅ Pass | One product action fans out two `$member.invite()` calls; both coexist as pending invites on the receiver. |
| E5 | One action accepts the bundle | ✅ Pass | One acceptance path consumes both invite IDs; the receiver ends up a member of both projects and reconstruction yields `ready`. |
| E6 | Fresh device, no default project | ✅ Pass (core half) | A brand-new `MapeoManager` starts with `listProjects() === []`. The onboarding UI that would offer only *Criar organização* / *Entrar em organização* is app-layer (see *Not covered*). |
| E7 | Partial failure + idempotent retry | ✅ Pass (receiver-side + create-side only) | After accepting only Monitoramento: org is `incomplete` (never prematurely `ready`); recovery goes through the same bundle-accept helper with the still-pending missing-slot invite — the present slot is skipped, not duplicated; re-inviting it answers `ALREADY`. Create-side: an interrupted provisioning resumes under the same `organizationId` (reconstruction supplies it) and provisions only the missing slot. The sender-half scenario (M invite starts, A invite fails) is NOT simulated — see *Not covered*. |
| E8 | Remote Archive at org level | ✅ Pass | The same server URL is added to both projects via `$member.addServerPeer()`; both list the server as a member with `selfHostedServerDetails`. |
| E9 | Marker survives ordinary use | ⚠️ Hazard proven | A plain `EditProjectDetails`-style `$setProjectSettings` save (user text replacing `projectDescription`) erases the marker: reconstruction degrades `ready` → `incomplete`, sibling slot untouched. See *Findings beyond the SPEC* #4 — the product layer must give the marker a read-only home. |

## Answers to the SPEC's open questions (section 13)

- **Q1 — two invites pending simultaneously?** Yes. Two project invites to
  the same device coexist as pending; each belongs to a distinct project API.
- **Q2 — receiver has all metadata before accepting?** Yes.
  `projectDescription` (marker) plus the invitor's device identity are present
  on the pending invite — the bundle can be formed and shown pre-accept.
- **Q3 — deterministic, safe grouping?** Yes. The validated bundle requires:
  parseable markers, one `organizationId`, one `invitorDeviceId`, one
  `roleName`, and two **distinct** slots (`m` + `a`). Anything else (junk
  descriptions, duplicates, one slot) does not group.
- **Q4 — one button accepts the bundle without core changes?** Yes. The
  product action coordinates two `invite.accept({inviteId})` calls.
- **Q5 — recovery when only one of two operations completes?** The state is
  never `ready` prematurely; the completed slot is detected locally and
  skipped; only the missing slot is retried; the sender side is naturally
  idempotent (`ALREADY` for an already-joined slot). On the create side the
  caller resumes with the `organizationId` it already has — reconstruction is
  the source of it after a restart; a naive re-call would mint a new org id
  and duplicate the completed slot.
- **Q6 — fresh device can start directly in an Organization?** Core half:
  yes — a fresh manager materializes no project, so onboarding can offer only
  the two Organization journeys. Both journeys end with exactly the two
  internal projects (creation path: `createOrganization`; joining path: bundle
  accept). The UI half is app-layer.

## Findings beyond the SPEC

1. **Restart identity**: a restarted manager over persisted folders must
   reuse the device's `rootKey` — a fresh key cannot decrypt the local
   database ("could not verify data"). The app already persists the root key,
   so this is a spike-harness note, not a product risk.
2. **Remote Archive server must allow ≥ 2 projects.** `@comapeo/cloud`
   defaults to `allowedProjects: 1` and rejects the second project with
   `ServerTooManyProjects`. COIAB's real archive server configuration must
   raise this limit, or the org-level archive fan-out (E8) fails on the
   second project. The spike threads an `allowedProjects` option through
   `createTestServer()`/`startTestCloudServer.mjs`.
3. **Failure paths can leak open handles**: when E8 failed mid-flow in an
   early spike run, the suite hung at exit. All-green runs exit cleanly, but
   it is a reminder that the product layer must own cleanup on every path.
   E8 now wraps its fan-out and assertions in `try/finally` so even a
   failed assertion closes the manager and the test server.
4. **The marker has no read-only home** (E9): `EditProjectDetails.tsx`
   already lets a coordinator replace `projectDescription` through
   `project.$setProjectSettings` (`useUpdateProjectSettings` from
   `@comapeo/core-react`). E9 proves the hazard: saving ordinary settings
   text through the real API orphans that slot — reconstruction degrades
   `ready` → `incomplete` with the other slot untouched. The product layer
   must either store the marker where settings edits cannot reach it (a
   dedicated field once core offers one) or intercept description edits to
   re-append the marker. As-is, an org can be silently dissolved by a
   routine rename of the project description.
5. **Recovery must validate organization identity**: the bundle-accept
   helper now refuses an invite whose marker names a different organization
   than the slots already local — without that guard, a second org's invite
   could fill the missing-slot gap of a partial acceptance and glue two
   organizations into one. It also refuses an invite whose marker names a
   different slot than the gap it fills: partial bundles bypass
   `groupInvitesIntoBundle`'s per-slot validation, so the slot must be
   re-checked at accept time.

## What the spike does not cover (app-layer only)

- **E2 UI half**: switching slots via `activeProjectId` in the running app,
  including the existing tracking-protection behavior on switch.
- **E6 UI half**: the onboarding screens offering only the two Organization
  journeys.
- **Send-side aggregation**: surfacing one "Convidar" button's two invite
  operations (states, errors, retries) as a single product action in UI.
- **E7 sender half**: an invite send failing mid-fan-out (SPEC section 14
  E7's "M invite iniciado / A invite falha" scenario) is not simulated. The
  spike proves receiver-side partial acceptance and create-side
  interruption; sender-side failure relies on the same per-slot retry
  mechanics (`ALREADY` idempotency, resume by organizationId).
- **Real multi-device conditions**: Wi-Fi/router conditions, device sleep,
  invite expiry in the field — the spike uses in-process peers on
  `127.0.0.1`.

## Implementation consequences

The spike's helper functions are the skeleton of the product layer:
`parseMarker`/`markerFor` (marker module), `reconstructOrganization`
(read model over `listProjects` + `$getProjectSettings`),
`createOrganization` (creation flow), `groupInvitesIntoBundle` +
`acceptOrganizationBundle` (invite surface). None of them touch core
internals; all consume public per-project APIs, so the layer lives entirely
in `src/frontend` (or a thin non-UI module it imports).

One deliberate divergence to fix when productizing:
`reconstructOrganization` returns the **first** organization found — a
single-org spike shortcut. SPEC section 10 requires a *collection* ("o
mapping é uma coleção de Organizações, não um singleton"; entering a second
organization is allowed in the MVP), so the product read model must return
every marker-bearing organization, not the first `Map` entry. The same
helper also re-reads settings per project through `$getProjectSettings()`;
`listProjects()` already returns `projectDescription`, so the product
version can drop that N+1.
