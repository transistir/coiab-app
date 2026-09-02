#!/usr/bin/env node
// Runs inside EAS Build's post-install hook, after EAS has unpacked its own
// git-based project snapshot and installed dependencies there. That snapshot
// respects .gitignore, so the Storybook index (.rnstorybook/storybook.requires.ts,
// gitignored, machine-generated) is never present in it — it must be
// (re)generated inside the build sandbox itself, right before the JS bundle
// is created. Only do this for Storybook builds; every other profile leaves
// this as a no-op.
import {execFileSync} from 'node:child_process';

if (process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true') {
  execFileSync('npm', ['run', 'storybook-generate'], {stdio: 'inherit'});
}
