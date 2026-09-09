---
name: sync-button-desktop-screenshot
description: Use when screenshotting a comapeo component with no story.
---

# Screenshot a comapeo component without a Storybook story

## Scope

This is a historical desktop/cloud-app recipe, not the COIAB React Native
capture path. Preserve the exact identifiers below for that environment;
first confirm the target actually contains `src/app/styles.css`, Vite and the
listed providers/store. Do not introduce desktop scaffolding into coiab-app
to make this recipe fit. COIAB implementation belongs only in
`transistir/coiab-app`; use `comapeo-storybook-capture` and
`comapeo-storybook-capture-gate` for native UI evidence. Never write to
`digidem/*`. Open every produced image before accepting it.

## Pattern

1. Check for a `.stories.tsx` first; if none, build a fixture HTML page **inside the worktree root** (e.g. `index-shot.html`) so vite serves it and resolves `/src/...` imports.
2. Page body: import `styles.css` via `<link rel="stylesheet" href="/src/app/styles.css">` (app CSS lives at `src/app/styles.css`, imports tailwindcss + theme tokens).
3. In a `<script type="module">`: render the component with `createElement` wrapped in `IntlProvider` + `ToastProvider`; set `useAuthStore.setState({servers: [...], activeServerId, token, baseUrl})`.
4. **Mock servers must include `onboardingStatus: 'complete'`** — `selectSyncableServers` filters on `baseUrl && token && onboardingStatus !== 'cancelled'`; omit it and the button renders disabled at 50% opacity.
5. Start vite in background (`npx vite --port 5199 --strictPort`), then run a playwright-core script: `page.goto('http://localhost:5199/index-shot.html')`, screenshot + optionally read computed styles (`getComputedStyle`, `getBoundingClientRect`) to verify enabled/opacity/height numerically.
6. Clean up fixture files before commit (they land as untracked).

## Gotchas

- Vite serves inline `<script type="module">` in HTML via `?html-proxy` — imports work but keep them at top of script; a missing import (e.g. `IntlProvider`) surfaces only as a pageerror at runtime, so capture `pageerror` events.
- `playwright-core` binary is in `node_modules/.bin`; run node scripts from the worktree root so `playwright-core` resolves (MODULE_NOT_FOUND otherwise).
- The `/@fs/tmp/...` path returns 403 from vite — always serve the fixture from project root.
- Dark theme: `dark bg-background text-foreground` classes on `<body>`; app default is CLOUD (light).