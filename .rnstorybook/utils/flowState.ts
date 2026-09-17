/**
 * Deterministic app-state presets for flow stories (see the PRD's
 * "Architecture" section: plans/2026-08-20-storybook-user-story-flows.md).
 *
 * `useFlowState` applies each axis of a `FlowStateSpec` to the running
 * session/backend and reports back once the observed state matches the
 * spec. It shares the project/observation-seeding logic with `seedData.ts`.
 */
import * as React from 'react';
import {useOwnDeviceInfo, useSetOwnDeviceInfo} from '@comapeo/core-react';
import {deviceType as expoDeviceType} from 'expo-device';

import {
  useSecurityActions,
  useSecurityState,
} from '../../src/frontend/contexts/SecurityStoreContext';
import {
  useActiveProjectId,
  useProjetarProjectIdAtivo,
} from '../../src/frontend/contexts/ActiveProjectIdStoreContext';
import {
  useCoiabOrganizationsState,
  useCoiabOrganizationsStoreContext,
} from '../../src/frontend/contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../../src/frontend/contexts/OrganizationActivationContext';
import {
  useDraftObservationActions,
  useDraftObservationState,
} from '../../src/frontend/contexts/DraftObservationContext';
import {expoToCoreDeviceType} from '../../src/frontend/lib/deviceTypeMap';
import {
  criarEstadoInicialOrganizacoes,
  derivarProjectIdAtivo,
  type EstadoOrganizacoes,
} from '../../src/frontend/lib/organization/coiabOrganizations';
import {repositorioDoStore} from '../../src/frontend/lib/organization/repositorio';
import {
  useSeedObservations,
  useSeedOrganization,
  useSeedOrganizationDocument,
  useSeedPointPreset,
  useSeedProject,
  type SeedOrganizations,
} from './seedData';

export type DraftObservationSpec =
  | 'none'
  | {state: 'empty'}
  | {state: 'preset-selected'; requireFields?: boolean};

export type FlowStateSpec = {
  auth?: 'authenticated' | 'unauthenticated';
  /** `null` clears the device name (see Open Question 1 in the PRD — confirmed clearable). */
  deviceName?: string | null;
  project?: 'none' | {name: string; observations?: number};
  /**
   * Seed one Organization. The normal two-slot form writes its valid COIAB
   * document through the running app's persisted store, then waits for the
   * production activation engine to open Monitoramento. `slots:
   * 'monitoramento'` intentionally remains the marker-only, incomplete state
   * used by the provisioning story. Alternative to `project` — presets that
   * use it set `project: 'none'`.
   */
  organization?: {
    name: string;
    slots?: 'both' | 'monitoramento';
    observations?: number;
  };
  /**
   * Seed ready organizations in the COIAB document (SPEC A §4.2) — the
   * registry the startup gate, the drawer and the Organizations selector
   * read; the startup gate ignores marker-only projects like the ones
   * `organization` seeds. Each organization's two area projects are created
   * in the backend and the active one's Monitoramento becomes the active
   * project; the document itself is provided to the story alone (see
   * `FlowStateScope`). Alternative to `project` and `organization` — presets
   * that use it set `project: 'none'`.
   */
  organizations?: SeedOrganizations;
  /**
   * Early access on or off for the story alone (see `FlowStateScope`); unset
   * leaves the app's persisted flag in charge.
   */
  earlyAccess?: boolean;
  draftObservation?: DraftObservationSpec;
};

export type ResolvedFlowState = {
  key: string;
  projectId?: string;
  observationIds: readonly string[];
  /**
   * Field doc ids of the preset resolved for `draftObservation: {state:
   * 'preset-selected'}`, in the same shape the real app passes to
   * `ObservationFields`'s `fieldIds` route param (see
   * `src/frontend/screens/ObservationCreate/index.tsx`). Undefined when no
   * preset-selected draft was requested.
   */
  presetFieldIds?: readonly string[];
  /**
   * The COIAB document seeded for `organizations`, for the decorators to
   * provide story-scoped. Undefined without that axis.
   */
  organizationDocument?: EstadoOrganizacoes;
  /** `earlyAccess` as requested, for the decorators to provide story-scoped. */
  earlyAccess?: boolean;
};

/**
 * Fixed ids (16 lowercase hex, like every organization id) keep the seed
 * idempotent across capture runs. B is the active one and sorts after A by
 * name, so the selector only lists B first if it really leads with the active
 * organization (SPEC A §6.1).
 */
const ORGANIZATION_A = {id: 'aaaaaaaaaaaaaaaa', name: 'Test Organization A'};
const ORGANIZATION_B = {id: 'bbbbbbbbbbbbbbbb', name: 'Test Organization B'};
const PERSISTED_ORGANIZATION_ID = '0123456789abcdef';

export const FLOW_STATES = {
  freshInstall: {
    auth: 'authenticated',
    deviceName: null,
    project: 'none',
  },
  lockedApp: {
    auth: 'unauthenticated',
    deviceName: 'Test Device',
    project: 'none',
  },
  namedNoProject: {
    auth: 'authenticated',
    deviceName: 'Test Device',
    project: 'none',
  },
  onboardedWithData: {
    auth: 'authenticated',
    deviceName: 'Test Device',
    project: 'none',
    organization: {name: 'Test Organization', observations: 5},
  },
  namedWithOrganization: {
    auth: 'authenticated',
    deviceName: 'Test Device',
    project: 'none',
    organization: {name: 'Test Organization'},
    draftObservation: 'none',
  },
  orgProvisioning: {
    auth: 'authenticated',
    deviceName: 'Test Device',
    project: 'none',
    organization: {name: 'Test Organization', slots: 'monitoramento'},
  },
  /**
   * Two ready organizations with early access on: the only state in which
   * the drawer offers the organization selector.
   */
  twoOrganizationsEarlyAccess: {
    auth: 'authenticated',
    deviceName: 'Test Device',
    project: 'none',
    organizations: {
      list: [ORGANIZATION_A, ORGANIZATION_B],
      activeId: ORGANIZATION_B.id,
    },
    earlyAccess: true,
    // A leftover draft is pending work, which keeps the story's activation
    // engine from opening the organization.
    draftObservation: 'none',
  },
} satisfies Record<string, FlowStateSpec>;

// 5 digits, not the reserved obscure code — see PasscodeInputSchema in
// src/frontend/lib/security.ts.
const DEV_PASSCODE = '13579';

const DEVICE_TYPE = expoToCoreDeviceType(expoDeviceType);

function buildKey(spec?: FlowStateSpec) {
  if (!spec) return 'flow:none';

  const project = spec.project;
  return JSON.stringify({
    auth: spec.auth ?? null,
    deviceName: Object.prototype.hasOwnProperty.call(spec, 'deviceName')
      ? spec.deviceName
      : '__flow_state_device_name_unset__',
    project:
      project === 'none'
        ? 'none'
        : project
          ? {name: project.name, observations: project.observations ?? 0}
          : null,
    organization: spec.organization
      ? {
          name: spec.organization.name,
          slots: spec.organization.slots ?? 'both',
          observations: spec.organization.observations ?? 0,
        }
      : null,
    ...(spec.organizations ? {organizations: spec.organizations} : {}),
    ...(spec.earlyAccess === undefined ? {} : {earlyAccess: spec.earlyAccess}),
    draftObservation: spec.draftObservation ?? null,
  });
}

function hasOnlyExpectedTags(
  tags: Record<string, unknown>,
  expectedTags: Record<string, unknown>,
) {
  const tagKeys = Object.keys(tags);
  const expectedKeys = Object.keys(expectedTags);
  return (
    tagKeys.length === expectedKeys.length &&
    expectedKeys.every(key => tags[key] === expectedTags[key])
  );
}

function sameOrganizationDocument(
  current: EstadoOrganizacoes,
  expected: EstadoOrganizacoes,
) {
  return JSON.stringify(current) === JSON.stringify(expected);
}

/**
 * Applies `spec` to the running backend/session, returning `null` while an
 * axis is still being applied and a stable `{key}` once the observed state
 * matches. Pass no spec to skip flow-state application entirely (e.g. for a
 * Walkthrough story that intentionally starts from whatever state a prior
 * story left behind).
 *
 * Known limitation: the `auth: 'unauthenticated'` axis sets the passcode,
 * but cannot force `AuthContext`'s `authState` to flip mid-session —
 * `authState` is local React state seeded once when `AuthProvider` mounts
 * (above Storybook) and is otherwise only changed by `authenticate()` or an
 * AppState background transition (src/frontend/contexts/AuthContext.tsx).
 * `lockedApp` therefore reflects on screen only on a fresh app boot with no
 * passcode set yet, not on-demand within a running Storybook session. Every
 * other preset only needs `auth: 'authenticated'`, which is what
 * `AuthContext` already boots into whenever no passcode was set at launch,
 * so this doesn't affect them.
 */
export function useFlowState(spec?: FlowStateSpec): ResolvedFlowState | null {
  const passcode = useSecurityState(state => state.passcode);
  const {setPasscode} = useSecurityActions();

  const {data: deviceInfo} = useOwnDeviceInfo();
  const {mutateAsync: setDeviceInfo} = useSetOwnDeviceInfo();

  const activeProjectId = useActiveProjectId();
  const projetar = useProjetarProjectIdAtivo();
  const coiabOrganizationsStore = useCoiabOrganizationsStoreContext();
  const persistedOrganizationState = useCoiabOrganizationsState();
  const organizationRepository = React.useMemo(
    () => repositorioDoStore(coiabOrganizationsStore),
    [coiabOrganizationsStore],
  );
  const {
    activate: activateOrganization,
    revalidate: revalidateOrganization,
    status: organizationActivationStatus,
    projectId: activatedOrganizationProjectId,
  } = useOrganizationActivationContext();

  const projectName =
    typeof spec?.project === 'object' ? spec.project.name : '';
  const {ensure: ensureProject} = useSeedProject(projectName);

  const orgSpec = spec?.organization;
  const persistedOrganizationSeed = React.useMemo<
    SeedOrganizations | undefined
  >(
    () =>
      orgSpec && (orgSpec.slots ?? 'both') === 'both'
        ? {
            list: [{id: PERSISTED_ORGANIZATION_ID, name: orgSpec.name}],
            activeId: PERSISTED_ORGANIZATION_ID,
          }
        : undefined,
    [orgSpec],
  );
  const {ensure: ensureOrganization} = useSeedOrganization(
    orgSpec?.name ?? '',
    orgSpec?.slots ?? 'both',
  );
  const {ensure: ensureOrganizationDocument} = useSeedOrganizationDocument(
    spec?.organizations ?? persistedOrganizationSeed,
  );

  const observationsCount =
    typeof spec?.project === 'object'
      ? (spec.project.observations ?? 0)
      : (spec?.organization?.observations ?? 0);
  const {ensure: ensureObservations} = useSeedObservations(observationsCount);

  const requirePresetFields =
    typeof spec?.draftObservation === 'object' &&
    spec.draftObservation.state === 'preset-selected' &&
    spec.draftObservation.requireFields === true;
  const {resolve: resolvePointPreset} = useSeedPointPreset({
    requireFields: requirePresetFields,
  });

  const draftState = useDraftObservationState();
  const {clearDraft, createDraft, updatePreset} = useDraftObservationActions();

  const [ready, setReady] = React.useState<ResolvedFlowState | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const specKey = buildKey(spec);
  const isReadyForCurrentSpec = ready !== null && ready.key === specKey;

  React.useEffect(() => {
    if (isReadyForCurrentSpec) return;

    let cancelled = false;
    const fail = (reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      }
    };

    if (!spec) {
      setReady({key: specKey, observationIds: []});
      return () => {
        cancelled = true;
      };
    }
    // Mutate one mismatched axis, then wait for that axis's subscription to
    // report the new value on a later render. In particular, do not mark the
    // flow ready immediately after a query mutation: RootStackNavigator has
    // its own subscription to these values and would otherwise mount from a
    // stale cache snapshot (PRD Risk 8).
    // Bind to a const: TS narrowing does not carry into this async closure.
    const spec_ = spec;
    const persistedDocument: EstadoOrganizacoes = {
      versao: persistedOrganizationState.versao,
      organizacoes: persistedOrganizationState.organizacoes,
      ativa: persistedOrganizationState.ativa,
    };

    async function apply() {
      // Each of these axes projects its own active project: combined, they
      // would overwrite one another on every pass and never converge.
      if (
        spec_.organizations &&
        (spec_.organization || typeof spec_.project === 'object')
      ) {
        throw new Error(
          'Storybook flow `organizations` cannot be combined with `organization` or a seeded `project`',
        );
      }

      if (spec_.auth === 'authenticated' && passcode !== null) {
        setReady(null);
        await setPasscode(null);
        if (cancelled) return;
        return;
      }

      if (spec_.auth === 'unauthenticated' && passcode === null) {
        setReady(null);
        await setPasscode(DEV_PASSCODE);
        if (cancelled) return;
        return;
      }

      const desiredDeviceName =
        spec_.deviceName === null ? '' : spec_.deviceName;
      if (
        typeof desiredDeviceName === 'string' &&
        deviceInfo.name !== desiredDeviceName
      ) {
        setReady(null);
        await setDeviceInfo({
          name: desiredDeviceName,
          deviceType: DEVICE_TYPE,
        });
        if (cancelled) return;
        return;
      }

      // A stale draft is pending work and the production activation engine
      // correctly refuses to change context while it exists. Presets that
      // explicitly request no draft must settle that axis before opening the
      // seeded organization, not after activation.
      if (spec_.draftObservation === 'none' && draftState.value !== null) {
        setReady(null);
        clearDraft();
        return;
      }

      const seedsPersistedOrganization =
        spec_.organization !== undefined &&
        (spec_.organization.slots ?? 'both') === 'both';
      if (
        !seedsPersistedOrganization &&
        !sameOrganizationDocument(
          persistedDocument,
          criarEstadoInicialOrganizacoes(),
        )
      ) {
        // Presets stay deterministic across story switches and cold runs. A
        // preset which does not request a complete persisted organization
        // clears the prior story's document through production's guarded
        // organization repository.
        setReady(null);
        organizationRepository.write(criarEstadoInicialOrganizacoes());
        return;
      }

      // With an organization spec present, the org axis owns the active
      // project id (it sets Monitoramento below) — the project:'none' clear
      // must not fight it, or the two axes would clear/set in an endless
      // alternation and the state would never converge.
      if (
        spec_.project === 'none' &&
        activeProjectId &&
        !spec_.organization &&
        !spec_.organizations
      ) {
        setReady(null);
        projetar(undefined);
        return;
      }

      let projectId = activeProjectId ?? undefined;
      let observationIds: readonly string[] = [];
      let organizationDocument: EstadoOrganizacoes | undefined;

      if (typeof spec_.project === 'object') {
        setReady(null);
        projectId = await ensureProject();
        if (cancelled) return;

        if (projectId !== activeProjectId) {
          projetar(projectId);
          return;
        }

        observationIds = await ensureObservations(projectId);
        if (cancelled) return;
      }

      if (spec_.organization) {
        setReady(null);
        if ((spec_.organization.slots ?? 'both') === 'monitoramento') {
          const monitoramentoId = await ensureOrganization();
          if (cancelled) return;

          if (monitoramentoId !== activeProjectId) {
            projetar(monitoramentoId);
            return;
          }
          projectId = monitoramentoId;
        } else {
          const document = await ensureOrganizationDocument();
          if (cancelled) return;
          if (!sameOrganizationDocument(persistedDocument, document)) {
            organizationRepository.write(document);
            return;
          }

          // The harness does not project this id. The production activation
          // engine is initialized only once, before this async seed finishes,
          // so request opening through its public API. It validates both
          // project roles and publishes Monitoramento exactly as a real open.
          const monitoramentoId = derivarProjectIdAtivo(document)!;
          if (
            organizationActivationStatus === 'ready' &&
            activatedOrganizationProjectId === monitoramentoId
          ) {
            if (monitoramentoId !== activeProjectId) {
              // A prior no-organization story can clear the persisted
              // document and legacy projection without remounting the root
              // engine. Revalidate the restored document through that engine,
              // then restore the same public projection its provider owns.
              const revalidated = await revalidateOrganization();
              if (cancelled) return;
              if (!revalidated) {
                throw new Error(
                  'Storybook could not revalidate persisted organization',
                );
              }
              projetar(monitoramentoId);
              return;
            }
          } else {
            if (
              organizationActivationStatus === 'loading' ||
              organizationActivationStatus === 'opening'
            ) {
              return;
            }
            const activated = await activateOrganization(
              PERSISTED_ORGANIZATION_ID,
              {area: 'monitoramento'},
            );
            if (cancelled) return;
            if (!activated) {
              throw new Error(
                `Storybook could not activate persisted organization; status: ${organizationActivationStatus}`,
              );
            }
            return;
          }
          projectId = monitoramentoId;
          observationIds = await ensureObservations(projectId);
          if (cancelled) return;
        }
      }

      if (spec_.organizations) {
        setReady(null);
        organizationDocument = await ensureOrganizationDocument();
        if (cancelled) return;

        // The seed only returns documents that derive an active project.
        const activeId = derivarProjectIdAtivo(organizationDocument)!;
        if (activeId !== activeProjectId) {
          projetar(activeId);
          return;
        }
        projectId = activeId;
      }

      const draftSpec = spec_.draftObservation;
      let presetFieldIds: readonly string[] | undefined;
      if (draftSpec) {
        if (!projectId && draftSpec !== 'none') {
          throw new Error(
            'Storybook flow draft setup requires an active seeded project',
          );
        }

        if (draftSpec === 'none') {
          if (draftState.value !== null) {
            setReady(null);
            clearDraft();
            return;
          }
        } else if (draftSpec.state === 'empty') {
          const isCompatibleEmptyDraft =
            draftState.value !== null &&
            draftState.id === null &&
            draftState.value.presetRef === undefined &&
            draftState.unsavedAttachments?.length === 0 &&
            draftState.value.attachments.length === 0 &&
            hasOnlyExpectedTags(draftState.value.tags, {notes: ''});

          if (!isCompatibleEmptyDraft) {
            setReady(null);
            if (draftState.value === null) {
              createDraft();
            } else {
              clearDraft();
            }
            return;
          }
        } else {
          const preset = await resolvePointPreset(projectId!);
          if (cancelled) return;
          presetFieldIds = preset.fieldRefs.map(fieldRef => fieldRef.docId);

          const expectedTags = {
            notes: '',
            ...preset.tags,
            ...preset.addTags,
          };
          const isCompatiblePresetDraft =
            draftState.value !== null &&
            draftState.id === null &&
            draftState.value.presetRef?.docId === preset.docId &&
            draftState.value.presetRef.versionId === preset.versionId &&
            draftState.unsavedAttachments?.length === 0 &&
            draftState.value.attachments.length === 0 &&
            hasOnlyExpectedTags(draftState.value.tags, expectedTags);
          const isCompatibleEmptyDraft =
            draftState.value !== null &&
            draftState.id === null &&
            draftState.value.presetRef === undefined &&
            draftState.unsavedAttachments?.length === 0 &&
            draftState.value.attachments.length === 0 &&
            hasOnlyExpectedTags(draftState.value.tags, {notes: ''});

          if (!isCompatiblePresetDraft) {
            setReady(null);
            if (draftState.value === null) {
              createDraft();
            } else if (isCompatibleEmptyDraft) {
              updatePreset(preset);
            } else {
              clearDraft();
            }
            return;
          }
        }
      }

      setReady({
        key: buildKey(spec_),
        projectId,
        observationIds,
        presetFieldIds,
        organizationDocument,
        earlyAccess: spec_.earlyAccess,
      });
    }

    apply().catch(fail);

    return () => {
      cancelled = true;
    };
  }, [
    activateOrganization,
    activeProjectId,
    activatedOrganizationProjectId,
    projetar,
    clearDraft,
    createDraft,
    deviceInfo.name,
    draftState,
    ensureObservations,
    ensureOrganization,
    ensureOrganizationDocument,
    ensureProject,
    isReadyForCurrentSpec,
    passcode,
    persistedOrganizationState,
    organizationRepository,
    revalidateOrganization,
    organizationActivationStatus,
    resolvePointPreset,
    setDeviceInfo,
    setPasscode,
    spec,
    updatePreset,
  ]);

  // Surface seeding failures loudly (nearest error boundary) rather than
  // hanging forever behind FlowStatePlaceholder with no visible cause.
  if (error) throw error;

  return isReadyForCurrentSpec ? ready : null;
}
