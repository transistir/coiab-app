import type {ComapeoCoreClientApi, ComapeoProjectClientApi} from '@comapeo/ipc';
import type {PresetImportado, ProjetoComPresets} from './pacotes';
import type {CreationClient, CreationProject} from './materializar';

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
const clientes = new WeakMap<
  ComapeoCoreClientApi,
  CreationClient<CreationProject & ProjetoComPresets>
>();

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

function criarProjetoDeCriacao(
  p: ProjetoClient,
): CreationProject & ProjetoComPresets {
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
    // NO `icon` member, BY EVIDENCE: core 7.4.0 / ipc 9.0.1 exposes NO public
    // icon DataType on MapeoProject — `icon.getMany()` REJECTS at runtime
    // ("ReferenceError: icon is not defined"; the icon DataType lives in the
    // private `#dataTypes`, Symbol-keyed, so rpc-reflector cannot expose it).
    // Announcing the member here made the optional guard in
    // `conferirImportacao` (pacotes.ts) believe a usable listing existed and
    // sank every verification as `leitura_falhou`; icon verification runs BY
    // REFERENCE instead (pacotes.ts `referenciasPorDocId`). To reintroduce
    // it when a core upgrade exposes a public listing: add the member back
    // ONLY after `tests/integration/cliente-superficie.test.ts` ("icon.getMany
    // NÃO existe no IPC") flips to a positive proof on the new core.
  };
}

export function clienteDeCriacao(
  api: ComapeoCoreClientApi,
): CreationClient<CreationProject & ProjetoComPresets> {
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
