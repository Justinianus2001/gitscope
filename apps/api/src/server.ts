import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';

async function main() {
  const config = loadConfig();
  const app = await buildApp({ config, logger: true });

  try {
    const address = await app.listen({
      host: config.API_HOST,
      port: config.API_PORT,
    });
    app.log.info(`GitScope API server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
