# Organization Layer Spike — Verdict

Spike for representing an Organization as a **frontend product layer over two
ordinary CoMapeo projects** (transistir/coiab-app#46), per
`docs/specs/SPEC-46-organizacao-camada-produto.md` (committed alongside this
document). This
document is the verdict; the
executable evidence is `tests/integration/spike-organization.test.ts`, which
drives `@comapeo/core` directly with two in-process devices connected through
a real local-peer connection path — explicit `connectLocalPeer`, not mDNS
discovery (and, for E8, a real `@comapeo/cloud` server in a child process).

**Update — app layer implemented.** The core-half verdict below is unchanged;
the sections it deferred to "app-layer only" are now implemented in this
branch (see *App-layer implementation* at the end). The final marker format
gained the organization name segment (the core-half tables below show the
older three-segment form used during those runs):

```
coiab-org:v1:<16-hex organizationId>:<slot>:<encodeURIComponent(name)>
```

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
| E1 | Create + reconstruct after restart | ✅ Pass | Two projects with markers, manager closed and recreated over the same folders, both project IDs reconstructed under the same `organizationId` from `listProjects()` + `$getProjectSettings()` alone. Also: a one-slot org reconstructs as `incomplete`, never `ready`; two local projects claiming the same slot reconstruct as `invalid` (`duplicate-slot`), never `ready`. |
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
6. **Recovery bundles cannot re-derive inviter/role** (known spike
   limitation): a full bundle is pinned by `groupInvitesIntoBundle` to one
   inviter and one role, but after an interrupted accept the consumed slot's
   invite is gone and leaves no local trace of who invited or in what role.
   The recovery path validates organization and slot, not inviter/role. The
   product layer must persist the bundle identity (inviter + role) at invite
   time and validate against it at recovery time.
7. **Duplicate slots surface as `invalid`, never `ready`**: if two local
   projects claim the same (organization, slot) — a retried create or a
   hand-edited marker — `reconstructOrganization` returns
   `{state: 'invalid', reason: 'duplicate-slot'}` instead of silently
   picking one project id. Reporting `ready` there would route product
   actions to an arbitrary project (last write wins).
8. **Role consistency is checked post-accept, not at grouping** (known
   spike limitation): the invite wire message (`Invite` RPC) carries
   `roleName` but not `roleId`, so the receiver cannot compare
   authoritative role ids before accepting — `groupInvitesIntoBundle`
   compares `roleName` because that is the only role signal the invite
   carries. A sender that issues one slot with role X and the other with
   role Y, both labeled with the same name, would group. The product layer
   must therefore (a) treat same-role fan-out as a sender-side invariant
   (both `$member.invite` calls use one roleId) and (b) verify after
   joining that its own member record holds the same roleId in both
   projects — the E3/E5 test asserts exactly that.

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

## App-layer implementation (this branch)

The product layer this document called for now exists and is exercised by
unit/integration tests (90 suites, 934 tests green; `npm run lint` clean).
What each deferred gap got:

| Deferred gap (above) | Implementation |
|---|---|
| E2 UI half (slot switching) | Reuses the existing AllProjects → `setActiveProjectId` switching and the tracking guard unchanged — the org layer adds nothing here and re-tests nothing (still covered only by upstream behavior; #32/#33 own the replacement). |
| E6 UI half (org-first onboarding) | Startup gate (`Navigation/Stack/index.tsx`): auth → device name → org state (`none` → org fork regardless of any active project id; `incomplete`/`invalid` → fail-closed `OrganizationProvisioning`; `ready` → Home). Fork offers only Create Organization / Join an Organization; `MapOnYourOwnIntro`/`JoinProjectIntro` stay registered but unreachable from onboarding. Real-navigator tests cover none-with-projects, incomplete, duplicate-slot, ready, and active-id correction. |
| Send-side aggregation (one Convidar button) | `ReviewOrganizationInvite` fans out both invites via `useInviteToOrganization` (concurrent `$member.invite` per slot, no `activeProjectId` switching), aggregates per-slot states, distinguishes timeout from error, and `Invite Again` re-sends only failed slots (SPEC 6.5). |
| E7 sender half | Still not simulated end-to-end on devices. The mechanics exist and are unit-tested (retry-only-failed, `ALREADY` = success, receiver-side duplicate collapse per slot), but no integration run drives a sender whose second invite fails mid-fan-out. |
| Marker has no read-only home (finding 4) | `EditProjectDetails` hides description editing for marker projects and round-trips the existing value on save (the E9 hazard is closed for this surface); `ProjectSettings`/`DrawerMenu` never render a raw marker (`displayDescription`). Note the residual risk below. |
| Recovery identity (finding 6) | Closed: the bundle identity (invitor + role) is persisted at first accept (`OrganizationInviteIdentityStoreContext`), the stored identity wins over any later bundle, and partial/recovery bundles require and match it (`OrganizationOperationError` codes `identity-required` / `identity-mismatch`). |
| First-org-only reconstruction / N+1 | `reconstructOrganizations` returns the full collection from `listProjects()` rows alone (joined-status rows only), sorted deterministically; duplicate-slot and unsupported-marker states fail closed. |
| Role parity check (finding 8) | Still roleName-based at grouping (wire limitation), but the sender-side single-role invariant is now structural (`useInviteToOrganization` takes one `roleId` for both slots) and the integration test asserts real `COORDINATOR_ROLE_ID` parity via `role.roleId` post-join. |

### Standalone-surface audit (SPEC 3.11)

No reachable product flow creates a standalone project:

- `MapOnYourOwnIntro` — unreachable from onboarding (P3 fork); route kept for deep links per SPEC 18.
- `InviteReceived` default-project fallback — deleted; the legacy surface handles only non-marker invites, which the COIAB onboarding never produces.
- `RemovedFromProjectBottomSheet` / `LeaveProject` — unnamed-project creation removed entirely (org and non-org paths): surviving org slot becomes active, else any remaining project, else the active id is cleared and the app lands on the org fork.
- Remaining `createProject` sites: `CreateOrNameSoloProject` (reachable only via AllProjects → Collaborate — the debug surface SPEC 18 keeps until #32/#33) and test code. The drawer's Collaborate entry requires the `solo` role, which exists only for an unnamed project — no product flow produces one anymore.

### Residual risks / open items

- **Marker write channel is still `projectSettings`**: any non-COIAB client (upstream CoMapeo app) editing a project's description on another device still erases the marker in the synced doc. The COIAB app can no longer do this to itself; cross-client protection needs a core-side field (deferred, SPEC 12).
- **Rename divergence**: `renameOrganization` exists (fan-out, marker-preserving, preflighted) but has no UI entry yet (#24); during propagation the two slots can briefly disagree — reconstruction resolves deterministically (slot `m` wins).
- **Real multi-device/emulator demonstrations** (two phones, Wi-Fi conditions, invite expiry in the field) remain unrun; all executable evidence is in-process (`connectLocalPeer` + real core) or component-level.
- **E2 UI half and E7 sender-half** as noted above.
- **`useManyInvites`-driven listener**: invite dedupe on the wire is per-project only (core), so the receiver-side collapse rules (newest `receivedAt`, tie → `inviteId`) are load-bearing; they are unit-pinned in `bundle.test.ts`.
