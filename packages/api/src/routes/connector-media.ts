/**
 * Connector Media Static File Route
 * Serves downloaded platform media (images, audio, files) from connector-media directory.
 * F088 Phase 5+6
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

export interface ConnectorMediaRoutesOptions {
  mediaDir: string;
}

export const connectorMediaRoutes: FastifyPluginAsync<ConnectorMediaRoutesOptions> = async (app, opts) => {
  await mkdir(resolve(opts.mediaDir), { recursive: true });
  await app.register(fastifyStatic, {
    root: resolve(opts.mediaDir),
    prefix: '/api/connector-media/',
    decorateReply: false,
  });
};
