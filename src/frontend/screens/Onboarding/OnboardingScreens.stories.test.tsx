import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import ethnicGroupMeta, {
  Default as EthnicGroupDefault,
} from './EthnicGroupSelection.stories';
import villageMeta, {Default as VillageDefault} from './VillageEntry.stories';
import {withFlowState} from '../../../../.rnstorybook/decorators/withFlowState';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The marker only depends on `useFlowState` resolving; the decorator's real
// seeding hooks need the whole app provider tree (backend, stores), which
// these stories deliberately do not use — each renders its own non-persisted
// profile store. Stub the resolution, keep the decorator real.
jest.mock('../../../../.rnstorybook/utils/flowState', () => ({
  useFlowState: () => ({key: 'flow:none'}),
}));

type StoryMeta = typeof ethnicGroupMeta;
type StoryFn = Parameters<typeof withFlowState>[0];
type StoryContext = Parameters<typeof withFlowState>[1];

/**
 * Renders a story through the decorators its own `meta` declares, exactly as
 * Storybook composes them (first decorator innermost). Reading them from
 * `meta` is the point: a story file that loses `decorators: [withFlowState]`
 * drops `STORYBOOK.flow-ready.<storyId>`, which is what the capture pipeline
 * waits on for every manifest row.
 */
function buildStory(
  meta: StoryMeta,
  renderStory: () => React.ReactNode,
  storyId: string,
): React.ComponentType {
  const context = {
    id: storyId,
    parameters: (meta as {parameters?: unknown}).parameters ?? {},
  } as unknown as StoryContext;
  const decorators = (meta.decorators ?? []) as Array<typeof withFlowState>;

  return decorators.reduceRight<React.ComponentType>(
    (Inner, decorator) => () => decorator(Inner as unknown as StoryFn, context),
    renderStory,
  );
}

/** Only used for its `render` function; Storybook passes args we ignore. */
type StoryLike = {render?: (...args: never[]) => React.ReactNode};

async function renderDefault(
  meta: StoryMeta,
  story: StoryLike,
  storyId: string,
) {
  const Story = buildStory(
    meta,
    () => (story.render ? story.render() : null),
    storyId,
  );

  await render(
    <IntlProvider locale="pt-BR" messages={{}}>
      <Story />
    </IntlProvider>,
  );
}

test('EthnicGroupSelection stories emit the capture readiness marker', async () => {
  await renderDefault(
    ethnicGroupMeta,
    EthnicGroupDefault,
    'onboarding-ethnicgroupselection--default',
  );

  expect(
    screen.getByTestId(
      'STORYBOOK.flow-ready.onboarding-ethnicgroupselection--default',
    ),
  ).toBeTruthy();
});

test('VillageEntry stories emit the capture readiness marker', async () => {
  await renderDefault(
    villageMeta,
    VillageDefault,
    'onboarding-villageentry--default',
  );

  expect(
    screen.getByTestId('STORYBOOK.flow-ready.onboarding-villageentry--default'),
  ).toBeTruthy();
});
