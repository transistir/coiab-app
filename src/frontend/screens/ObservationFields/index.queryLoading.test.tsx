import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import * as Sentry from '@sentry/react-native';

import {ObservationFields} from './index';
import {useFieldsQuery} from '../../hooks/server/fields';

jest.mock('../../hooks/server/fields', () => ({
  useFieldsQuery: jest.fn(),
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

// The prevent-remove listener's behavior is covered by the integration tests;
// not relevant to the query-loading window under test here.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: jest.fn(),
}));

jest.mock('../../contexts/DraftObservationContext', () => ({
  useDraftObservationState: (selector: (state: unknown) => unknown) =>
    selector(mockDraftState),
  useDraftObservationActions: () => ({updateTag: mockUpdateTag}),
}));

// Field input components are irrelevant to navigation behavior under test.
jest.mock('./SelectOne', () => ({SelectOne: () => null}));
jest.mock('./SelectMultiple', () => ({SelectMultiple: () => null}));
jest.mock('./Number', () => ({Number: () => null}));
jest.mock('./Date', () => ({DatePicker: () => null}));
jest.mock('./TextArea', () => ({TextArea: () => null}));

const useFieldsQueryMock = useFieldsQuery as jest.Mock;
const captureExceptionMock = Sentry.captureException as jest.Mock;

const mockUpdateTag = jest.fn();
const mockDraftState = {
  id: undefined,
  value: {tags: {}},
};

const FIELD = {
  docId: 'field-1',
  tagKey: 'note',
  label: 'Field test details',
  type: 'text',
};

const navigation = {
  setOptions: jest.fn(),
  goBack: jest.fn(),
  popTo: jest.fn(),
  dispatch: jest.fn(),
};

function screenProps(fieldIds: string[]) {
  return {
    navigation,
    route: {
      key: 'ObservationFields',
      name: 'ObservationFields',
      params: {fieldIds},
    },
  } as unknown as React.ComponentProps<typeof ObservationFields>;
}

function renderWith(element: React.ReactElement) {
  return render(
    <IntlProvider locale="en" onError={() => {}}>
      {element}
    </IntlProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ObservationFields while fields query has not loaded', () => {
  test('does not go back or report to Sentry, then renders the field once the query resolves', async () => {
    // Query still loading: no data yet.
    useFieldsQueryMock.mockReturnValue({
      data: undefined,
      error: null,
      isRefetching: false,
    } as never);

    const view = await renderWith(
      <ObservationFields {...screenProps(['field-1'])} />,
    );

    // Not loaded yet: must NOT pop navigation nor fire a Sentry error.
    // Rendering nothing (null) is acceptable.
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(screen.queryByText(FIELD.label)).toBeNull();
    expect(view.toJSON()).toBeNull();

    // Query resolves: the field renders normally, still without going back.
    useFieldsQueryMock.mockReturnValue({
      data: [FIELD],
      error: null,
      isRefetching: false,
    } as never);

    await view.rerender(
      <IntlProvider locale="en" onError={() => {}}>
        <ObservationFields {...screenProps(['field-1'])} />
      </IntlProvider>,
    );

    expect(screen.getByText(FIELD.label)).toBeVisible();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  test('still goes back and reports to Sentry when fields loaded but the field id is absent', async () => {
    useFieldsQueryMock.mockReturnValue({
      data: [FIELD],
      error: null,
      isRefetching: false,
    } as never);

    await renderWith(
      <ObservationFields {...screenProps(['field-that-does-not-exist'])} />,
    );

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
