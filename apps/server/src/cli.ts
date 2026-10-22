import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { SCOPES, USER_ROLES, type Scope, type UserRole } from '@ixfwms/domain';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { AppError } from './lib/errors.js';
import { createServices, prepareDatabase } from './services/index.js';

const HELP = `ixfwms admin CLI

  init                                   Create/upgrade the database and seed defaults
  user:create --name <n> [--role member|admin|viewer]
  user:list
  token:create --user <n> [--name <label>] [--scopes inventory,write]
  token:revoke --id <token id>
  backup                                 Snapshot the database into <data>/backups

Environment: IXF_DATA_DIR (default ./data), IXF_DB_URL.
In Docker:   docker compose exec ixfwms node apps/server/dist/cli.js <command> ...`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      role: { type: 'string', default: 'member' },
      user: { type: 'string' },
      scopes: { type: 'string', default: 'inventory' },
      id: { type: 'string' },
    },
  });
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  await mkdir(config.dataDir, { recursive: true });
  const database = await openDatabase(config.dbUrl);
  const services = createServices(database, config);
  try {
    await prepareDatabase(database, services, (m) => console.error(m));
    switch (command) {
      case 'init':
        console.log(`Database ready at ${config.dbUrl}`);
        break;
      case 'user:create': {
        if (!values.name) throw new AppError('invalid', '--name is required');
        if (!USER_ROLES.includes(values.role as UserRole))
          throw new AppError('invalid', `--role must be one of ${USER_ROLES.join(', ')}`);
        const user = await services.auth.createUser(values.name, values.role as UserRole);
        console.log(`Created user ${user.name} (${user.role})`);
        break;
      }
      case 'user:list':
        for (const u of await services.auth.listUsers())
          console.log(`${u.name}\t${u.role}\t${u.id}`);
        break;
      case 'token:create': {
        if (!values.user) throw new AppError('invalid', '--user is required');
        const scopes = values.scopes.split(',').map((s) => s.trim()) as Scope[];
        if (scopes.some((s) => !SCOPES.includes(s)))
          throw new AppError('invalid', `--scopes must be from ${SCOPES.join(', ')}`);
        const { token, id } = await services.auth.createToken(
          values.user,
          values.name ?? 'cli',
          scopes,
        );
        console.error(
          `Token ${id} for ${values.user} with scopes ${scopes.join(', ')}. It is shown only once:`,
        );
        console.log(token);
        break;
      }
      case 'token:revoke':
        if (!values.id) throw new AppError('invalid', '--id is required');
        await services.auth.revokeToken(values.id);
        console.log('Revoked');
        break;
      case 'backup':
        console.log(await services.backup.backup('manual'));
        break;
      default:
        throw new AppError('invalid', `Unknown command "${command}"\n\n${HELP}`);
    }
  } finally {
    database.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof AppError ? err.message : err);
  process.exit(1);
});
