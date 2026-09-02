import type {InitialState} from '@react-navigation/native';
import type {Meta, StoryObj} from '@storybook/react-native';
import {withRealNavigator} from '../../../.rnstorybook/decorators/withRealNavigator';
import {
  FLOW_STATES,
  type ResolvedFlowState,
} from '../../../.rnstorybook/utils/flowState';

/**
 * The real navigator renders the journey; this placeholder only satisfies
 * Storybook's component requirement.
 */
const NoStoryComponent = () => null;

const meta = {
  title: 'Flows/CreateObservation',
  component: NoStoryComponent,
  decorators: [withRealNavigator],
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const homeMapState: InitialState = {
  routes: [
    {
      name: 'Home',
      state: {
        routes: [{name: 'Map'}],
        index: 0,
      },
    },
  ],
  index: 0,
};

const categoryChooserState: InitialState = {
  routes: [homeMapState.routes[0]!, {name: 'ObservationCategoryChooser'}],
  index: 1,
};

const observationCreateState: InitialState = {
  routes: [
    homeMapState.routes[0]!,
    {name: 'ObservationCategoryChooser'},
    {name: 'ObservationCreate'},
  ],
  index: 2,
};

const addPhotoState: InitialState = {
  routes: [
    homeMapState.routes[0]!,
    {name: 'ObservationCategoryChooser'},
    {name: 'ObservationCreate'},
    {name: 'AddPhoto'},
  ],
  index: 3,
};

/**
 * `fieldIds` is the same route param the real app passes from
 * `ObservationCreate`/`ObservationEdit` (`preset.fieldRefs.map(f => f.docId)`)
 * — read from the resolved flow state rather than hardcoded, since the seeded
 * preset (and therefore its field ids) isn't known until `requireFields:
 * true` resolves it.
 */
const observationFieldsState = (resolved: ResolvedFlowState): InitialState => {
  if (!resolved.presetFieldIds || resolved.presetFieldIds.length === 0) {
    throw new Error(
      'Storybook flow expected a resolved preset with fields (requireFields: true) but presetFieldIds is empty',
    );
  }

  return {
    routes: [
      homeMapState.routes[0]!,
      {name: 'ObservationCategoryChooser'},
      {name: 'ObservationCreate'},
      {
        name: 'ObservationFields',
        params: {fieldIds: [...resolved.presetFieldIds]},
      },
    ],
    index: 3,
  };
};

const onboardedNoDraft = {
  ...FLOW_STATES.onboardedWithData,
  draftObservation: 'none' as const,
};

/** The complete create-observation journey, starting at the map. */
export const Walkthrough: Story = {
  parameters: {
    flow: {state: onboardedNoDraft, initialState: homeMapState},
  },
};

/** The map screen used as the entry point for creating an observation. */
export const Home: Story = {
  name: '01 Home',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: homeMapState},
  },
};

/** The category chooser with a fresh empty observation draft. */
export const CategoryChooser: Story = {
  name: '02 Category Chooser',
  parameters: {
    flow: {
      state: {
        ...FLOW_STATES.onboardedWithData,
        draftObservation: {state: 'empty'},
      },
      initialState: categoryChooserState,
    },
  },
};

/** The add-photo screen after selecting the seeded point preset. */
export const AddPhoto: Story = {
  name: '03 Add Photo',
  parameters: {
    flow: {
      state: {
        ...FLOW_STATES.onboardedWithData,
        draftObservation: {state: 'preset-selected'},
      },
      initialState: addPhotoState,
    },
  },
};

/** The observation form after selecting the seeded point preset. */
export const ObservationCreate: Story = {
  name: '04 Observation Create',
  parameters: {
    flow: {
      state: {
        ...FLOW_STATES.onboardedWithData,
        draftObservation: {state: 'preset-selected'},
      },
      initialState: observationCreateState,
    },
  },
};

/** The first required field of the seeded point preset. */
export const ObservationFields: Story = {
  name: '05 Observation Fields',
  parameters: {
    flow: {
      state: {
        ...FLOW_STATES.onboardedWithData,
        draftObservation: {state: 'preset-selected', requireFields: true},
      },
      initialState: observationFieldsState,
    },
  },
};

/** An existing seeded observation, resolved instead of guessed by ID. */
export const ObservationDetail: Story = {
  name: '06 Observation Detail',
  parameters: {
    flow: {
      state: onboardedNoDraft,
      initialState: (resolved: ResolvedFlowState) => ({
        routes: [
          homeMapState.routes[0]!,
          {
            name: 'Observation',
            params: {observationId: resolved.observationIds[0]!},
          },
        ],
        index: 1,
      }),
    },
  },
};
