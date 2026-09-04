---
name: figma-pat
description: Read-only Figma access through the figma-pat MCP server (figma-developer-mcp, personal access token) — use whenever a Figma URL, file key, or node id needs layout, styles, or image assets fetched. Covers URL parsing, scoping large responses, and downloading assets.
---

# Figma PAT server

`figma-pat` is a user-scoped stdio MCP server (`figma-developer-mcp --stdio`,
authenticated via `FIGMA_API_KEY` expanded from the `FIGMA_TOKEN` env var in
`~/.claude.json`). It gives read-only access to any Figma file the token can
reach: node tree, layout, styles, and asset/image downloads.

Prefer it over the official OAuth server (`plugin:figma:figma` /
`mcp.figma.com`) for reads — no browser auth, never expires. The official
server is still needed for: current-selection canvas context, Code Connect,
design generation, FigJam.

## Tools

- `get_figma_data` — simplified node tree with layout/fill/style variables.
  Args (0.13.2 schema): `fileKey` (required), `nodeId` (optional — always
  pass when the URL has one), `depth` (do not use unless the user asks).
- `download_figma_images` — fetches renders or image assets as png/svg/gif.

## Parse a Figma URL

```
https://www.figma.com/design/lfGdmeMSB7PoJGIvE0NtTM/Kutary-App---V2?node-id=2668-4449
                              ^^^^^^^^^^^^^^^^^ fileKey            ^^^^^^^^^ nodeId
```

- `fileKey`: path segment after `/design/` (or `/file/`), before the title.
- `nodeId`: `node-id` query param. May arrive URL-encoded as `2668%3A4449` —
  decode `%3A` to `:` before passing (the schema rejects `%`). Both `:` and
  `-` separators are accepted.
- `/proto/` URLs carry the same file key (`figma.com/proto/<key>/...`) and
  usually a `node-id` — parse them the same way. FigJam `/board/` and short
  `figma.com/sl/...` share links don't expose a usable key/node — resolve
  them in a browser first, then use the canonical `/design/` URL.

## Workflow

1. `get_figma_data` with `nodeId` scoped to the screen/section named in the
   URL. Without `nodeId` the whole file serializes — one frame produced a
   280 KB response; a full file is far larger.
2. To implement or visually verify, render the node:
   `download_figma_images` with:
   - `nodes: [{ nodeId, fileName }]` — `nodeId` is required on every node
     entry, including imageRef/gifRef asset downloads. `fileName` must match
     `[a-zA-Z0-9_.-]+\.(png|svg|gif)` (no spaces; extension required).
   - `localPath`: relative to the server's image directory — its spawn CWD,
     normally the repo root. The rule is containment, not an absolute-path
     ban: paths resolving outside that directory are refused. If unsure,
     trust the directory named in the error message over an assumption.
   - `pngScale`: defaults to 2. It scales but does not tame big nodes: a
     large parent frame containing many screens rendered 6281x5341 (4 MB)
     even at `pngScale: 1`. Plan to downscale locally rather than fighting
     the scale.
3. For image-fill assets inside a node: same node entry plus the `imageRef`
   (or `gifRef` for animated) from the `get_figma_data` output. When present
   in the data, also pass `needsCropping`, `cropTransform`,
   `requiresImageDimensions`, `filenameSuffix` as given.

## Gotchas

- Renders of big frames take over a minute — don't kill the process at 60 s;
  a truncated PNG has valid dims but no `IEND` chunk at the tail. If a
  download is interrupted, delete the partial file and re-run.
- Visual inspection of downloaded renders: resize under 2000x2000 first
  (`python3 -c "from PIL import Image; im=Image.open('x.png'); im.thumbnail((1500,1500)); im.save('x-small.png')"`),
  then Read the small copy.
- Server is read-only. "What's currently selected in the editor" is not
  available — that lives in the official OAuth server.

## Environment

- Token: `FIGMA_TOKEN` env var (needs `file_content:read`; add
  `file_dev_resources:read` for dev resources). If tools return 401, check
  the token still exists in Figma account settings → Security → Personal
  access tokens.
- Telemetry: `FRAMELINK_TELEMETRY=off` and `DO_NOT_TRACK=1` are set in the
  server's env block in `~/.claude.json`.
