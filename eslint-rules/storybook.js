/**
 * ESLint rules for Storybook-only seams in app source.
 *
 * no-seam-outside-stories: error when a prop or type that exists solely so a
 *   Storybook story can drive a screen into a state the real route cannot
 *   reach is used from anywhere other than a `*.stories.tsx` file.
 *
 *   These seams are ordinary exported, fully typed app source, so they look
 *   like supported API and are attractive to anyone debugging the screen,
 *   building a demo mode, or writing a unit test. A production call site
 *   would type-check, lint clean and pass CI while rendering fixtured state
 *   to a real user. The convention that only stories may use them is
 *   documented in `.rnstorybook/README.md`; this makes it enforceable.
 *
 *   Configure with the seams to guard, and switch the rule off for
 *   `*.stories.tsx` in the flat config rather than matching filenames here:
 *
 *     ['error', {seams: [{
 *       component: 'ExchangeScreenContent',
 *       prop: 'overrides',
 *       types: ['ExchangeScreenContentOverrides'],
 *     }]}]
 *
 *   The declaring file is not exempted and does not need to be: it declares
 *   the type rather than importing it, and does not render itself.
 */

const noSeamOutsideStories = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Storybook-only props and types outside *.stories.tsx',
    },
    schema: [
      {
        type: 'object',
        properties: {
          seams: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                component: {type: 'string'},
                prop: {type: 'string'},
                types: {type: 'array', items: {type: 'string'}},
              },
              required: ['component', 'prop'],
              additionalProperties: false,
            },
          },
        },
        required: ['seams'],
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const seams = context.options[0].seams;

    function elementName(openingElement) {
      const name = openingElement.name;
      if (name.type === 'JSXIdentifier') return name.name;
      // <Screens.ExchangeScreenContent /> — the last part is the component
      if (name.type === 'JSXMemberExpression') return name.property.name;
      return undefined;
    }

    function reportProp(node, seam) {
      context.report({
        node,
        message: `\`${seam.prop}\` on \`${seam.component}\` is a Storybook-only seam; use it from a *.stories.tsx file, or drive the real route into this state instead`,
      });
    }

    return {
      ImportSpecifier(node) {
        const imported = node.imported.name;
        for (const seam of seams) {
          if (!seam.types || !seam.types.includes(imported)) continue;
          context.report({
            node,
            message: `\`${imported}\` types a Storybook-only seam on \`${seam.component}\`; it is not part of the screen's supported API`,
          });
        }
      },

      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        const parentName = elementName(node.parent);
        for (const seam of seams) {
          if (node.name.name !== seam.prop) continue;
          if (parentName !== seam.component) continue;
          reportProp(node, seam);
        }
      },

      // <ExchangeScreenContent {...{overrides}} /> would otherwise slip past
      // the attribute check above.
      JSXSpreadAttribute(node) {
        if (node.argument.type !== 'ObjectExpression') return;
        const parentName = elementName(node.parent);
        for (const seam of seams) {
          if (parentName !== seam.component) continue;
          const spreadsProp = node.argument.properties.some(
            property =>
              property.type === 'Property' &&
              !property.computed &&
              (property.key.name === seam.prop ||
                property.key.value === seam.prop),
          );
          if (spreadsProp) reportProp(node, seam);
        }
      },
    };
  },
};

// eslint-disable-next-line no-undef
module.exports = {
  rules: {
    'no-seam-outside-stories': noSeamOutsideStories,
  },
};
