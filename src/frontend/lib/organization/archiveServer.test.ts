import {MEMBER_ROLE_ID} from '../../sharedTypes';
import {
  archiveServerMatchesIdentity,
  consultarArquivoRemotoAtivo,
} from './archiveServer';

function membro({
  deviceId,
  baseUrl,
  roleId = MEMBER_ROLE_ID,
  deviceType = 'selfHostedServer',
}: {
  deviceId: string;
  baseUrl?: string;
  roleId?: string;
  deviceType?: string;
}) {
  return {
    deviceId,
    name: deviceId,
    deviceType,
    role: {roleId},
    ...(baseUrl ? {selfHostedServerDetails: {baseUrl}} : {}),
  } as never;
}

function projetoCom(membros: ReturnType<typeof membro>[]) {
  return {
    $member: {
      getMany: jest.fn(async () => membros),
    },
  };
}

const A = membro({
  deviceId: 'server-a',
  baseUrl: 'https://a.example',
});
const B = membro({
  deviceId: 'server-b',
  baseUrl: 'https://b.example',
});

describe('identidade do arquivo remoto (#142 10ª rodada)', () => {
  test('só considera ativo o membro cuja identidade corresponde', async () => {
    // `a` has A and B applied: removing A must not be "still present" just
    // because B is active.
    const getProject = jest.fn(async () => projetoCom([A, B]));

    await expect(
      consultarArquivoRemotoAtivo(getProject, 'org-1-a', {
        baseUrl: 'https://a.example/',
        deviceId: 'server-a',
      }),
    ).resolves.toBe(true);

    await expect(
      consultarArquivoRemotoAtivo(getProject, 'org-1-a', {
        baseUrl: 'https://c.example/',
        deviceId: 'server-c',
      }),
    ).resolves.toBe(false);
  });

  test('deviceId vence e não confunde dois servidores com URLs distintas', async () => {
    expect(archiveServerMatchesIdentity(A, {deviceId: 'server-b'})).toBe(false);
    expect(archiveServerMatchesIdentity(A, {deviceId: 'server-a'})).toBe(true);
    // Without a device id, the normalized base URL decides (trailing slash is
    // not part of the identity).
    expect(
      archiveServerMatchesIdentity(B, {baseUrl: 'https://b.example/'}),
    ).toBe(true);
    expect(
      archiveServerMatchesIdentity(B, {baseUrl: 'https://a.example/'}),
    ).toBe(false);
  });

  test('membro que não é arquivo ativo nunca corresponde', async () => {
    const getProject = jest.fn(async () =>
      projetoCom([
        membro({
          deviceId: 'server-a',
          baseUrl: 'https://a.example',
          roleId: 'blocked-role',
        }),
      ]),
    );

    await expect(
      consultarArquivoRemotoAtivo(getProject, 'org-1-a', {
        baseUrl: 'https://a.example',
      }),
    ).resolves.toBe(false);
  });
});
