/**
 * @module
 * This script is run by tests.
 *
 * We want to start a fake cloud server in tests, but `@comapeo/cloud` only
 * supports ESM, which Jest does not support. This works around that.
 *
 * Alternatively, we could add CommonJS support to `@comapeo/cloud` or use
 * Jest's ESM support, but this workaround is, amazingly, easier.
 */

/* global console, process */
import comapeoServer from '@comapeo/cloud';
import createFastify from 'fastify';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import * as path from 'node:path';
import RAM from 'random-access-memory';

const require = createRequire(import.meta.url);
const COMAPEO_CORE_PKG_FOLDER = path.dirname(
  path.dirname(require.resolve('@comapeo/core')),
);
const projectMigrationsFolder = path.join(
  COMAPEO_CORE_PKG_FOLDER,
  'drizzle/project',
);
const clientMigrationsFolder = path.join(
  COMAPEO_CORE_PKG_FOLDER,
  'drizzle/client',
);

const server = createFastify();

// The cloud server limits how many projects it hosts (`allowedProjects`,
// default 1). Tests that need more (e.g. an Organization with two projects)
// pass the limit through this env var.
const allowedProjectsFromEnv = Number.parseInt(
  process.env.TEST_SERVER_ALLOWED_PROJECTS ?? '',
  10,
);

server.register(comapeoServer, {
  rootKey: randomBytes(16),
  projectMigrationsFolder,
  clientMigrationsFolder,
  dbFolder: ':memory:',
  coreStorage: () => new RAM(),
  serverName: 'test server',
  serverBearerToken: 'ignored',
  allowedProjects: Number.isNaN(allowedProjectsFromEnv)
    ? 1
    : allowedProjectsFromEnv,
});

console.log(await server.listen());
