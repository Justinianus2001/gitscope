import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import type Database from 'better-sqlite3';
import { type EnvConfig } from '@gitscope/shared';
import { loadConfig } from './config/index.js';
import { createDb } from './db/client.js';
import { migrate } from './db/migrator.js';
import { healthRoutes } from './routes/health.js';
import { repositoryRoutes } from './routes/repositories.js';
import { commitRoutes } from './routes/commits.js';
import { graphRoutes } from './routes/graph.js';

export interface AppOptions {
  config?: EnvConfig;
  db?: Database.Database;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: EnvConfig;
    db: Database.Database;
  }
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const db = options.db ?? createDb({ path: config.DATABASE_PATH });

  // Run pending schema migrations
  migrate(db);

  const fastify = Fastify({
    logger: options.logger ?? false,
  });

  // Decorate fastify with config and db
  fastify.decorate('config', config);
  fastify.decorate('db', db);

  // Register plugins
  await fastify.register(cors, {
    origin: true,
  });
  await fastify.register(sensible);

  // Error handling: never leak stack traces or internal paths to client
  fastify.setErrorHandler((error: FastifyError | Error, _request, reply) => {
    fastify.log.error(error);

    const statusCode =
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;

    if (statusCode >= 500) {
      reply.status(statusCode).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected internal error occurred.',
        },
      });
      return;
    }

    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'REQUEST_ERROR';

    reply.status(statusCode).send({
      error: {
        code,
        message: error.message,
      },
    });
  });

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(repositoryRoutes);
  await fastify.register(commitRoutes);
  await fastify.register(graphRoutes);

  // Graceful shutdown hook
  fastify.addHook('onClose', async () => {
    if (db && !options.db) {
      db.close();
    }
  });

  return fastify;
}
