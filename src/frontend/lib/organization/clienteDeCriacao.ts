import type {ComapeoCoreClientApi, ComapeoProjectClientApi} from '@comapeo/ipc';
import type {ClienteDeEntrada, ProjetoDeEntrada} from './entrada';
import type {PresetImportado} from './pacotes';

/**
 * Production `CreationClient` over the real IPC client of @comapeo/core.
 * `getProject` returns an EXPLICIT wrapper — never a spread of the IPC
 * proxy: rpc-reflector's client objects are live proxies whose nested
 * namespaces are callable, so a spread would either invoke them or freeze
 * the wrong surface. The wrapper is also the one place that converts
 * `file:///…` URIs into the plain path Core's `$importCategories` requires.
 */
// Identity must be stable: the materializer keys its exclusive-operation
// registry on the client object (materializar.ts `running`), so two
// `clienteDeCriacao(api)` calls for one api MUST return one object.
const clientes = new WeakMap<ComapeoCoreClientApi, ClienteDeEntrada>();

/**
 * Core reads packages by a plain filesystem path (it passes it to
 * `styled-package-reader`), not by URI: the template source yields
 * `file:///…` paths (expo-file-system documentDirectory), so the scheme and
 * any URI escapes are stripped exactly here.
 */
function caminhoPuro(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}

type ProjetoClient = ComapeoProjectClientApi;

function criarProjetoDeCriacao(p: ProjetoClient): ProjetoDeEntrada {
  return {
    $member: {
      getById: (id: string) => p.$member.getById(id),
    },
    $importCategories: ({filePath}: {filePath: string}) =>
      p.$importCategories({filePath: caminhoPuro(filePath)}),
    $setProjectSettings: (settings: {
      name: string;
      sendStats: boolean;
      projectDescription: string;
    }) => p.$setProjectSettings(settings),
    $getProjectSettings: () => p.$getProjectSettings(),
    preset: {
      // Core `Tags` values allow null-valued arrays (`TagsPacote` is the
      // narrower package shape the import pipeline actually writes).
      getMany: () =>
        p.preset.getMany() as unknown as Promise<PresetImportado[]>,
    },
    field: {
      getMany: () => p.field.getMany(),
    },
    // SPEC B §5.5: a joined project exposes Core's own-role read — the
    // entry confirmation walks it (CREATOR/COORDINATOR/MEMBER).
    $getOwnRole: () => p.$getOwnRole(),
    // NO `icon` listing member, BY EVIDENCE: core 7.4.0 / ipc 9.0.1 exposes
    // NO public icon DataType on MapeoProject — `icon.getMany()` REJECTS at
    // runtime ("ReferenceError: icon is not defined"; the icon DataType
    // lives in the private `#dataTypes`, Symbol-keyed, so rpc-reflector
    // cannot expose it). `conferirImportacao` decides the listing's
    // presence STATICALLY (rpc-reflector proxies make every property
    // callable), so no member is announced unless a core upgrade exposes a
    // public listing — readd it ONLY after
    // tests/integration/cliente-superficie.test.ts ("icon.getMany NÃO
    // existe no IPC") flips to a positive proof.
    // The icon PROOF instead resolves each referenced docId THROUGH CORE's
    // icon HTTP route (Decision C): `getIconUrl` only builds a URL, so the
    // fetch is what actually reads the blob — the route 404s a dangling
    // docId, and `fetch(...).ok` surfaces that as false. The options are
    // the ONLY variant `$importCategories` writes (import-categories.js
    // :82-91): `{mimeType: 'image/svg+xml', size: 'medium'}`.
    iconeResolvivel: async (docId: string) =>
      (
        await fetch(
          await p.$icons.getIconUrl(docId, {
            mimeType: 'image/svg+xml',
            size: 'medium',
          }),
        )
      ).ok,
  };
}

export function clienteDeCriacao(api: ComapeoCoreClientApi): ClienteDeEntrada {
  let cliente = clientes.get(api);
  if (!cliente) {
    cliente = {
      getDeviceInfo: () => api.getDeviceInfo(),
      setDeviceInfo: deviceInfo => api.setDeviceInfo(deviceInfo),
      listProjects: () => api.listProjects(),
      createProject: options => api.createProject(options),
      getProject: async (id: string) =>
        criarProjetoDeCriacao(await api.getProject(id)),
    };
    clientes.set(api, cliente);
  }
  return cliente;
}
