import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {useSingleMember} from '@comapeo/core-react';
import {NotFoundError} from '@comapeo/core/errors.js';
import {captureException} from '@sentry/react-native';

import {ObserverSection} from './ObserverSection';

jest.mock('@comapeo/core-react', () => ({
  useSingleMember: jest.fn(),
}));

jest.mock('@sentry/react-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const captureException = jest.fn();

  class ErrorBoundary extends ReactActual.Component<
    {
      children?: React.ReactNode;
      fallback?: (props: {error: Error}) => React.ReactNode;
    },
    {error: Error | null}
  > {
    state = {error: null};

    static getDerivedStateFromError(error: Error) {
      return {error};
    }

    componentDidCatch(error: Error) {
      captureException(error);
    }

    render() {
      if (this.state.error) {
        return this.props.fallback
          ? this.props.fallback({error: this.state.error})
          : null;
      }

      return this.props.children;
    }
  }

  return {captureException, ErrorBoundary};
});

jest.mock('../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: 'project-1', projectApi: {}}),
}));

const useSingleMemberMock = useSingleMember as jest.Mock;
const captureExceptionMock = captureException as jest.Mock;

const MESSAGES = {
  '$1screens.Observation.observerEthnicity': 'Etnia do observador',
  '$1screens.Observation.observerVillage': 'Aldeia do observador',
  '$1screens.Observation.recordedBy': 'Registrado por',
};

const TAGS = {
  'coiab:etnia': 'Mawayana',
  'coiab:aldeia': 'Aldeia Nova',
};

function renderSection() {
  return render(
    <IntlProvider locale="pt-BR" messages={MESSAGES}>
      <ObserverSection createdBy="device-1" tags={TAGS} />
    </IntlProvider>,
  );
}

describe('ObserverSection', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    captureExceptionMock.mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('consulta de membro pendente não esconde etnia e aldeia', async () => {
    // O hook usa suspense: uma promessa que nunca resolve mantém o nome do
    // aparelho suspenso, mas etnia e aldeia vêm das tags e devem aparecer.
    useSingleMemberMock.mockImplementation(() => {
      throw new Promise(() => {});
    });

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
  });

  test('consulta de membro com erro não derruba nem esconde etnia e aldeia', async () => {
    useSingleMemberMock.mockImplementation(() => {
      throw new Error('member query failed');
    });

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
  });

  test('membro ainda não sincronizado não vira evento no Sentry', async () => {
    // `NotFoundError` é esperado quando o membro que criou a observação
    // ainda não sincronizou: não deve poluir o Sentry.
    useSingleMemberMock.mockImplementation(() => {
      throw Object.assign(new Error('member not found'), {
        code: 'NOT_FOUND_ERROR',
      });
    });

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  test('instância real de NotFoundError não vira evento no Sentry', async () => {
    // O erro real do core cruza o RPC como instância de `Error` com `code`;
    // `getErrorCode` deve reconhecê-lo sem depender de `instanceof
    // NotFoundError` (o protótipo pode não sobreviver).
    useSingleMemberMock.mockImplementation(() => {
      throw new NotFoundError();
    });

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  test('erro inesperado no membro vira evento no Sentry', async () => {
    useSingleMemberMock.mockImplementation(() => {
      throw new Error('boom');
    });

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  test('membro resolvido mostra o nome de quem registrou', async () => {
    useSingleMemberMock.mockReturnValue({data: {name: 'Tablet 1'}});

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
    expect(screen.getByText('Registrado por')).toBeOnTheScreen();
    expect(screen.getByText('Tablet 1')).toBeOnTheScreen();
  });
});
