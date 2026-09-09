# Remote Archive: current model and the org-level path

Technical confirmation of how Remote Archive works today and the
lowest-effort path to an organization-level ("org-level") archive, answering
the two open questions of transistir/coiab-app#35:

1. *Que parte pode ser feita apenas no frontend (propagar a mesma config a N
   projetos)?* — Everything (section 3).
2. *Existe limitação do modelo atual que force trabalho abaixo da camada de
   UI?* — No app-side limitation. The only hard constraints are operator-side
   server configuration and one reachability caveat on removal (section 4).

## 1. The current model is per-project, stored as project membership

There is no archive configuration stored anywhere outside the project. A
Remote Archive server is **a member of a project**:

- `deviceType: 'selfHostedServer'`
- role `MEMBER`
- `selfHostedServerDetails: { baseUrl }`

All app flows key off that membership:

| Flow | Entry point | What happens |
|------|-------------|--------------|
| Add | `screens/RemoteArchive/AddRemoteArchive.tsx` | Coordinator types a URL → `normalizeRemoteArchiveUrl` → `GET <url>/info` (`useFindRemoteArchive`, `hooks/server/projects.ts`) shows the server's name → confirm → `useAddServerPeer` (`@comapeo/core-react`) → `project.$member.addServerPeer(baseUrl)` |
| Read | `screens/RemoteArchive/index.tsx` | `useActiveArchiveServer({projectId})` scans project members for a `selfHostedServer` member with `MEMBER` role (`isActiveArchiveServerMember`, `hooks/server/projects.ts`) |
| Remove | `screens/RemoteArchive/RemoveRemoteArchive.tsx` | `useRemoveServerPeer` → `project.$member.removeServerPeer(serverDeviceId)` |
| Gate | `screens/RemoteArchive/index.tsx` | Only coordinators (`COORDINATOR_ROLE_ID` or `CREATOR_ROLE_ID`) can add or remove |

Once the server is a member, it participates in project sync like any other
peer — over the internet — and its progress surfaces through the same
sync-state machinery the Exchange screen already renders. There is no
separate "upload to archive" code path.

Upstream note: `isActiveArchiveServerMember` carries a TODO referencing
digidem/comapeo-core#1031 (recognizing archive members is currently a
frontend concern, ideally moved into @comapeo/core). That is cosmetic for us;
the detection logic is stable.

## 2. Constraints the API enforces (from `@comapeo/core` `member-api.d.ts`)

`addServerPeer(baseUrl)` can reject with:

- `INVALID_URL` — malformed base URL.
- `MISSING_DATA` — required data missing; **the project must have a name**.
- `NETWORK_ERROR` — device or server offline.
- `SERVER_HAS_TOO_MANY_PROJECTS` — the server limits how many projects it
  hosts and is at the limit.
- `PROJECT_NOT_IN_SERVER_ALLOWLIST` — the server only accepts specific
  projects and ours was not one.
- `INVALID_SERVER_RESPONSE` — server running an incompatible CoMapeo Cloud
  version.

`removeServerPeer(serverDeviceId)` **only works while the server peer is
reachable**. Removing an archive while the server is down fails; the UI must
retry later.

Server-side, `@comapeo/cloud` accepts `allowedProjects?: number | string[]`
(`dist/routes.d.ts:5`) — either a maximum project count or an explicit
project-id allowlist. **It defaults to `1`**, which is why a single server
hosting two organization projects rejects the second `addServerPeer` with
`SERVER_HAS_TOO_MANY_PROJECTS`. This was verified experimentally in the
organization-layer spike (transistir/comapeo-mobile-1#74, experiment E8):
with `allowedProjects: 2` one server archived both org projects
simultaneously; with the default it did not.

## 3. Org-level archive = frontend fan-out (answer to question 1)

Under the organization product layer (SPEC-46: an org is N projects plus a
marker, frontend-only), an org-level archive is:

> For each project in the organization, call
> `project.$member.addServerPeer(sameBaseUrl)`.

This is entirely public API from `src/frontend`. No change to
`@comapeo/core`, `@comapeo/cloud`, or any below-UI layer is required in app
code. Preconditions, all satisfied by the org-layer model:

- **Caller is coordinator of each project.** The org creator is
  creator/coordinator of both org projects (they create them), so one device
  can fan out the whole org.
- **Each project has a name.** Org projects always do (`MISSING_DATA`
  otherwise).
- **The server accepts each project.** Operator-side; see section 4.

The UI side is a new org-settings surface showing one archive row for the
whole org: *add* fans out with per-project error handling — retry only the
failed slots, the same partial-failure pattern proven for invite bundles in
the spike (E5/E7); *remove* fans out `removeServerPeer` per project.

## 4. Limitations — none force below-UI work (answer to question 2)

| Limitation | Where it lives | Blocks frontend-only? |
|------------|----------------|-----------------------|
| Server hosts at most `allowedProjects` projects (default **1**) | Operator's `@comapeo/cloud` config | No — server config, not app code. The COIAB archive server must set `allowedProjects` ≥ number of org projects (or allowlist the org project ids). |
| `removeServerPeer` needs the server reachable | `@comapeo/core` API | No — frontend handles partial failure and retry |
| UI assumes one archive server per project (`useActiveArchiveServer` returns the first matching member) | App UI convention | No — keep the org fan-out 1:1 (one server across all org projects) |
| No aggregate "org archive health" state in core | `@comapeo/core` | No — frontend aggregates the N per-project sync states |

## 5. Recommendation

Build the org-level archive as a **frontend fan-out over the org's projects**
using the existing per-project `addServerPeer`/`removeServerPeer`, presented
through a single org-settings surface. Pair it with an operator checklist
item: the COIAB archive server instance must be configured with
`allowedProjects` raised above 1 (the default rejects the second org
project).

## 6. Plan B (declared per the issue's requirement)

If org-level archive turns out to require a below-UI change after all — for
example if `@comapeo/core` changes membership semantics — the demo falls back
to **per-project manual configuration by the operator**: add the same archive
URL through the existing *Project Settings → Remote Archive* screen on each
org project. This works with the app exactly as it is today, at the cost of
N manual steps and no aggregate status view.
