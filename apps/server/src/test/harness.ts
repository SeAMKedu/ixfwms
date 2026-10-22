import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { buildApp } from '../http/app.js';
import { createServices, prepareDatabase, type Actor, type Services } from '../services/index.js';

export interface TestEnv {
  config: Config;
  services: Services;
  admin: Actor;
  adminToken: string;
  /** A token limited to the `inventory` scope, like an AI assistant would get. */
  inventory: Actor;
  inventoryToken: string;
  app: Awaited<ReturnType<typeof buildApp>>;
  cleanup(): Promise<void>;
}

export async function createTestEnv(env: Record<string, string> = {}): Promise<TestEnv> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ixfwms-test-'));
  // No web build by default, so tests see the server's own pages whether or not apps/web was built.
  const config = loadConfig({
    IXF_DATA_DIR: dataDir,
    IXF_BACKUP_KEEP: '2',
    IXF_WEB_DIR: join(dataDir, 'no-web'),
    ...env,
  });
  const database = await openDatabase(config.dbUrl);
  const services = createServices(database, config);
  await prepareDatabase(database, services, () => {});
  await services.auth.createUser('admin', 'admin');
  await services.auth.createUser('assistant', 'member');
  const adminToken = (await services.auth.createToken('admin', 'test', ['admin'])).token;
  const inventoryToken = (await services.auth.createToken('assistant', 'test', ['inventory']))
    .token;
  const app = await buildApp({ config, services, version: '0.0.0-test' });
  return {
    config,
    services,
    admin: (await services.auth.verify(adminToken))!,
    adminToken,
    inventory: (await services.auth.verify(inventoryToken))!,
    inventoryToken,
    app,
    async cleanup() {
      await app.close();
      database.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
