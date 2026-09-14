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
    icon: {
      // PLAN: core 7.4.0 has NO public `icon` DataType on MapeoProject —
      // `icon.getMany()` REJECTS at runtime ("ReferenceError: icon is not
      // defined"; see tests/integration/cliente-superficie.test.ts). The
      // member is kept to match the planned surface until the plan decides
      // how icon verification reads icons.
      getMany: () =>
        (
          p as unknown as {
            icon: {
              getMany(): Promise<
                Array<{docId?: string; name?: string; deleted?: boolean}>
              >;
            };
          }
        ).icon.getMany(),
    },
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
