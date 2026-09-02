# CoMapeo Build scripts

This is not a complete index of `scripts/` — most entries here are documented at
their point of use. The two families worth pointing at from here:

## Storybook capture pipeline

`storybook-capture.sh`, `storybook-capture-all.sh`, `storybook-report.mjs` and
`storybook-generate-if-enabled.mjs` produce the deterministic flow screenshots
uploaded by the `storybook-capture` workflow. They are documented in
[`.agents/skills/comapeo-storybook-capture/SKILL.md`](../.agents/skills/comapeo-storybook-capture/SKILL.md),
with the review procedure for the resulting frames in
[`.agents/skills/comapeo-storybook-capture-gate/SKILL.md`](../.agents/skills/comapeo-storybook-capture-gate/SKILL.md).

`storybook-fixtures.sh` is their test suite. It stubs `adb`, `sleep` and the
per-story capture command, so it needs no emulator and no device:

```sh
npm run test:scripts
```

CI runs it in the `all` job.

## [`build-intl-polyfills.mjs`](./build-intl-polyfills.mjs)

Script used for generating a file that serves as a module to import polyfill-related code from [`@formatjs`](https://formatjs.io/). This polyfils various `Intl` APIs that are necessary for internationalization support in the app.

https://formatjs.io/docs/polyfills

Currently, we polyfill the following APIs:

- [`Intl.getCanonicalLocales`](https://formatjs.io/docs/polyfills/intl-getcanonicallocales)
- [`Intl.locale`](https://formatjs.io/docs/polyfills/intl-locale/)
- [`Intl.PluralRules`](https://formatjs.io/docs/polyfills/intl-pluralrules)
- [`Intl.RelativeTimeFormat`](https://formatjs.io/docs/polyfills/intl-relativetimeformat)
