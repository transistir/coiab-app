// @ts-nocheck
/* eslint-disable no-undef */
const {RuleTester} = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const {rules} = require('./storybook.js');

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2020,
    sourceType: 'module',
    parserOptions: {ecmaFeatures: {jsx: true}},
  },
});

const options = [
  {
    seams: [
      {
        component: 'ExchangeScreenContent',
        prop: 'overrides',
        types: ['ExchangeScreenContentOverrides'],
      },
    ],
  },
];

ruleTester.run('no-seam-outside-stories', rules['no-seam-outside-stories'], {
  valid: [
    // The shipping call site, which passes only real props.
    {
      code: `<ExchangeScreenContent syncState={syncState} />;`,
      options,
    },
    // The declaring file: it declares the type rather than importing it, and
    // does not render itself, so it needs no exemption.
    {
      code: `
        export type ExchangeScreenContentOverrides = {ssid?: string | null};
        export function ExchangeScreenContent({
          overrides,
        }: {
          overrides?: ExchangeScreenContentOverrides;
        }) {
          return overrides;
        }
      `,
      options,
    },
    // A prop of the same name on some other component is not this seam.
    {
      code: `<SomeOtherThing overrides={fixture} />;`,
      options,
    },
    // A spread of unrelated props onto the guarded component.
    {
      code: `<ExchangeScreenContent {...{syncState}} />;`,
      options,
    },
    // An unrelated import from the same module.
    {
      code: `import {ExchangeScreenContent} from './ExchangeScreenContent';`,
      options,
    },
  ],
  invalid: [
    {
      code: `<ExchangeScreenContent syncState={syncState} overrides={fixture} />;`,
      options,
      errors: [{message: /Storybook-only seam/}],
    },
    {
      // Member-expression element names resolve to the component name.
      code: `<Screens.ExchangeScreenContent overrides={fixture} />;`,
      options,
      errors: [{message: /Storybook-only seam/}],
    },
    {
      // A spread object literal would otherwise slip past the attribute check.
      code: `<ExchangeScreenContent {...{overrides: fixture}} />;`,
      options,
      errors: [{message: /Storybook-only seam/}],
    },
    {
      code: `<ExchangeScreenContent {...{'overrides': fixture}} />;`,
      options,
      errors: [{message: /Storybook-only seam/}],
    },
    {
      code: `import {ExchangeScreenContentOverrides} from './ExchangeScreenContent';`,
      options,
      errors: [{message: /not part of the screen's supported API/}],
    },
    {
      code: `import {type ExchangeScreenContentOverrides} from './ExchangeScreenContent';`,
      options,
      errors: [{message: /not part of the screen's supported API/}],
    },
  ],
});
