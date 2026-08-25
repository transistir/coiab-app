/**
 * Seed data utilities for Storybook stories.
 *
 * These call the imperative @comapeo/core-react client API (not the
 * suspense-query hooks) so they can be called from `flowState.ts` before a
 * project id is known to exist — `useManyDocs`/`useSingleProject` etc. would
 * suspend or throw if called with an invalid projectId, and flow-state
 * application often runs before any project has been created. Pattern
 * otherwise follows src/frontend/screens/ComapeoSettings/CreateTestData.tsx.
 *
 * Usage: call `ensure()` from `flowState.ts` (or a story's effect). All
 * stories share the same running backend, so data persists between stories.
 * Both hooks are idempotent (see comments below) so re-running the same
 * spec does not keep piling up projects/observations.
 */
import * as React from 'react';
import {useClientApi} from '@comapeo/core-react';
import {lengthToDegrees} from '@turf/helpers';
import {randomPosition} from '@turf/random';
import {type BBox} from 'geojson';
import type {Preset} from '@comapeo/schema';

import type {Metadata} from '../../src/frontend/sharedTypes';

const DISTANCE_BUFFER_KM = 50;

// Quito, Ecuador — arbitrary but stable center point for seeded observations.
// Real location isn't meaningful for a story; only having *some* valid,
// clustered coordinates is.
const SEED_CENTER = {latitude: -0.1807, longitude: -78.4678};

/**
 * Ensure a project named `name` exists and return its id.
 *
 * Idempotent: looks up an existing project by name before creating one, so
 * re-running with the same name reuses it instead of creating a duplicate.
 */
export function useSeedProject(name: string) {
  const clientApi = useClientApi();

  const ensure = React.useCallback(async (): Promise<string> => {
    const projects = await clientApi.listProjects();
    const existing = projects.find(project => project.name === name);
    if (existing) return existing.projectId;
    return clientApi.createProject({name});
  }, [clientApi, name]);

  return {ensure};
}

/**
 * Ensure at least `count` observations exist in the project passed to
 * `ensure(projectId)` and return the docIds of the first `count` of them
 * (existing ones first, then any newly created ones).
 *
 * `projectId` is a parameter of `ensure()` rather than of the hook itself so
 * callers can seed a project id that was only just resolved (e.g. by
 * `useSeedProject`) in the same async sequence, without a stale closure.
 *
 * Idempotent: only creates the shortfall between what already exists and
 * `count`, so re-running with the same count is a no-op after the first run.
 */
export function useSeedObservations(count: number, options?: {lang?: string}) {
  const clientApi = useClientApi();
  const lang = options?.lang;

  const ensure = React.useCallback(
    async (projectId: string): Promise<string[]> => {
      const projectApi = await clientApi.getProject(projectId);
      const [existingObservations, presets] = await Promise.all([
        projectApi.observation.getMany({lang}),
        projectApi.preset.getMany({lang}),
      ]);

      const existingIds = existingObservations
        .map(observation => observation.docId)
        .sort();
      const deficit = count - existingIds.length;
      if (deficit <= 0 || presets.length === 0) {
        return existingIds.slice(0, count);
      }

      const distanceBufferDegrees = lengthToDegrees(
        DISTANCE_BUFFER_KM,
        'kilometers',
      );
      const {latitude, longitude} = SEED_CENTER;
      const bbox: BBox = [
        longitude - distanceBufferDegrees,
        latitude - distanceBufferDegrees,
        longitude + distanceBufferDegrees,
        latitude + distanceBufferDegrees,
      ];

      const tasks: Promise<string>[] = [];
      for (let i = 0; i < deficit; i++) {
        const [lon, lat] = randomPosition({bbox});
        if (lon == null || lat == null) {
          throw new Error('randomPosition invalid');
        }

        const randomPreset =
          presets[Math.floor(Math.random() * presets.length)];
        if (!randomPreset) continue;

        const metadata: Metadata = {
          manualLocation: false,
          position: {
            mocked: false,
            timestamp: new Date().toISOString(),
            coords: {latitude: lat, longitude: lon},
          },
        };

        const value = {
          schemaName: 'observation' as const,
          attachments: [],
          tags: {...randomPreset.tags, notes: 'Seeded by Storybook'},
          lat,
          lon,
          metadata,
        };

        tasks.push(projectApi.observation.create(value).then(doc => doc.docId));
      }

      const newIds = await Promise.all(tasks);
      return [...existingIds, ...newIds].sort().slice(0, count);
    },
    [clientApi, count, lang],
  );

  return {ensure};
}

/**
 * Pick the point preset a draft-backed flow story should render, from the
 * presets a project's config exposes.
 *
 * Deterministic *across* capture runs, not just within one. Every run seeds a
 * fresh project, so `docId` — which is generated when the config is written —
 * is a different value each time; ordering by it produced a different preset
 * on every run while looking stable in the code. `name` comes from the config
 * itself, so it survives project re-creation, and it makes the choice legible:
 * a reviewer can tell which preset a frame should show by reading the config
 * rather than by running a capture.
 *
 * Compared by code unit rather than by `localeCompare`, whose ordering depends
 * on the ICU data available to the runtime. `docId` breaks ties, which only
 * matters for a config that ships two point presets under one name.
 */
export function selectPointPreset(
  presets: ReadonlyArray<Preset>,
  options?: {requireFields?: boolean},
): Preset | undefined {
  const requireFields = options?.requireFields ?? false;

  return presets
    .filter(
      preset =>
        preset.geometry.includes('point') &&
        (!requireFields || preset.fieldRefs.length > 0),
    )
    .sort((a, b) => {
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      if (a.docId !== b.docId) return a.docId < b.docId ? -1 : 1;
      return 0;
    })[0];
}

/**
 * Resolve the deterministic point preset used by draft-backed flow stories.
 * This only reads project config; applying the preset remains the draft
 * store's responsibility.
 */
export function useSeedPointPreset(options?: {
  lang?: string;
  requireFields?: boolean;
}) {
  const clientApi = useClientApi();
  const lang = options?.lang;
  const requireFields = options?.requireFields ?? false;

  const resolve = React.useCallback(
    async (projectId: string): Promise<Preset> => {
      const projectApi = await clientApi.getProject(projectId);
      const presets = await projectApi.preset.getMany({lang});
      const preset = selectPointPreset(presets, {requireFields});

      if (!preset) {
        throw new Error(
          requireFields
            ? `Storybook flow could not find a point preset with fields in project ${projectId}`
            : `Storybook flow could not find a point preset in project ${projectId}`,
        );
      }

      return preset;
    },
    [clientApi, lang, requireFields],
  );

  return {resolve};
}
