import { mkdir } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { buildApp } from './http/app.js';
import { createServices, prepareDatabase } from './services/index.js';
import { readVersion } from './version.js';

const config = loadConfig();
const version = readVersion();
await mkdir(config.dataDir, { recursive: true });

const database = await openDatabase(config.dbUrl);
const services = createServices(database, config);
const app = await buildApp({ config, services, version }, { level: config.logLevel });

await prepareDatabase(database, services, (msg) => app.log.info(msg));
const stopBackups =
  config.backupHour >= 0
    ? services.backup.schedule(config.backupHour, (err) =>
        app.log.error(err, 'Nightly backup failed'),
      )
    : () => {};

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopBackups();
  await app.close();
  database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
app.log.info(
  `ixfwms ${version} listening on ${config.host}:${config.port}, data in ${config.dataDir}` +
    (config.publicUrl
      ? `, public URL ${config.publicUrl}`
      : ', public URL taken from each request'),
);
