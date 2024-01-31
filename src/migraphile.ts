#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-misused-promises */
import path from 'path'
import net from 'net'
import fs from 'fs'
import { highlight } from 'cli-highlight'
import chalk from 'chalk'
import { Pool, type PoolClient } from 'pg'
import { commit, uncommit, migrate, reset, watch, status, init, type Settings } from 'graphile-migrate'
import { spawnSync } from 'child_process'
import assert from 'assert'
import * as dotenv from 'dotenv'
import { Logger, type LogMeta } from '@graphile/logger'
import chokidar from 'chokidar'
import * as fastq from 'fastq'
import type { queueAsPromised } from 'fastq'

type Task = CommitTask | UncommitTask | RunCurrentTask | OrmDoneTask | RunMigrationsTask | ResetShadowTask | StatusTask | InitCommand

type CommitTask = {
  name: 'commit'
  args: string
}

type UncommitTask = {
  name: 'uncommit'
}

type RunCurrentTask = {
  name: 'run_current'
}

type OrmDoneTask = {
  name: 'orm_done'
}

type RunMigrationsTask = {
  name: 'migrate'
}

type ResetShadowTask = {
  name: 'reset_shadow'
}

type StatusTask = {
  name: 'status'
}

type InitCommand = {
    name: 'init'
}

const processDir = process.cwd()

dotenv.config({
  path: path.join(processDir, '.env')
})

const PORT = 5105

const dbUri = process.env.DB_URI
const rootDbUri = process.env.ROOT_DB_URI
const shadowDbUri = process.env.SHADOW_DB_URI
const ormDbUri = process.env.ORM_DB_URI
const ormName = process.env.ORM_NAME || 'ORM'
const baselineFile = process.env.BASELINE_FILE
const schemas = process.env.SCHEMAS || 'public'

const CURRENT_FILE_PATH = path.join(processDir, 'current', '1-current.sql')

const GRAPHILE_MIGRATE = `💻 ${chalk.italic.hex('#ff795b')('Graphile Migrate')}`
const MIGRA = chalk.italic.hex('#ff7d00')('Migra')
const ORM_NAME = chalk.italic.green(ormName)
const CURRENT_SQL = chalk.italic.cyan('current.sql')
const EMPTY_MIGRATION_TEXT = '-- Enter migration here\n'
const COMMAND_DESCRIPTION_TAB_SPACING = ' '.repeat(12)
const COMMAND_TAB_SPACING = ' '.repeat(8)

const getDbName = (dbUri: string): string => {
  const url = new URL(dbUri)
  return url.pathname.slice(1)
}

const prettyDb = (dbUri: string): string => {
  const dbName = getDbName(dbUri)

  if (dbUri === shadowDbUri) {
    return `👻 ${chalk.italic.yellow(dbName)}`
  }

  if (dbUri === ormDbUri) {
    return `⚙️ ${chalk.italic.green(dbName)}`
  }

  if (dbUri === rootDbUri) {
    return `🔑 ${chalk.italic.red(dbName)}`
  }

  return `📦 ${chalk.italic.cyan(dbName)}`
}

const highlightOptions = {
  language: 'sql',
  ignoreIllegals: true,
  theme: {
    keyword: chalk.yellow.bold,
    type: chalk.red.bold
  }
}

const taskMap: {
  [taskName in Task['name']]: {
    usage: string
    description: string[]
    method: Function
  }
} = {
  commit: {
    usage: `${chalk.bold('commit')} ${chalk.yellow.italic('<description>')}`,
    description: [
      'Commits the current migration to the shadow database.',
      `Example: ${chalk.bold.green('commit Add users table')}`
    ],
    method: async (task: Task): Promise<void> => {
      assert(task.name === 'commit')
      const description = task.args.trim()
      if (!description) {
        console.error(`❌ No description provided`)
        return
      }

      await commitMigration(description)
    }
  },
  uncommit: {
    usage: `${chalk.bold('uncommit')}`,
    description: ['Uncommits the last migration from the shadow database.'],
    method: async (): Promise<void> => {
      await uncommitMigration()
    }
  },
  run_current: {
    usage: `${chalk.bold('run_current')}`,
    description: ['Runs the current migration on the local database.'],
    method: async (): Promise<void> => {
      await runCurrent()
    }
  },
  orm_done: {
    usage: `${chalk.bold('orm_done')}`,
    description: [
      `Called by ${ORM_NAME} when it has finished generating a migration.`,
      `This will update the current migration file with the migration generated by ${ORM_NAME}.`,
      `This will also run the migration on the shadow database.`
    ],
    method: async (): Promise<void> => {
      await ormDone()
    }
  },
  migrate: {
    usage: `${chalk.bold('migrate')}`,
    description: ['Runs all migrations on the local database.'],
    method: async (): Promise<void> => {
      await runMigrations()
    }
  },
  reset_shadow: {
    usage: `${chalk.bold('reset_shadow')}`,
    description: ['Resets the shadow database to the state of the local database.'],
    method: async (): Promise<void> => {
      await resetShadowDb()
    }
  },
  status: {
    usage: `${chalk.bold('status')}`,
    description: ['Shows the status of the migrations.'],
    method: async (): Promise<void> => {
      await getStatus()
    }
  },
  init: {
    usage: `${chalk.bold('init')}`,
    description: ['Initializes the migration server.'],
    method: async (): Promise<void> => {
      await init({
        folder: true
      })
      // This will create a "./migrations" folder, we need to move everything up one level to ".".
      const migrationsFolder = path.join('.', 'migrations')
      const files = fs.readdirSync(migrationsFolder)
      files.forEach(file => {
          fs.renameSync(path.join(migrationsFolder, file), path.join('.', file))
      })
      fs.rmdirSync(migrationsFolder)

      // Open up the file ./.gmrc and replace the following: ./migrations with './'
      const gmrcFile = path.join('.', '.gmrc')
      const initConfig: Settings = {
        ...graphileSettings,
        migrationsFolder: './',
        logger: undefined,
      }
      fs.writeFileSync(gmrcFile, JSON.stringify(initConfig, null, 2))
    }
  }
}

const parseGraphileMigrateMessage = (message: string): { dbType: string; dbMessage: string } => {
  // Can be one of:
  // graphile-migrate[shadow]: <message>
  // graphile-migrate: <message> (default to db instead of shadow)
  const messageParts = message.match(/graphile-migrate(\[(.*)])?: (.*)/)
  const dbType = messageParts?.[2] || 'db'
  const dbMessage = messageParts?.[3] || message

  return {
    dbType,
    dbMessage
  }
}

function logFunctionFactory(_scope: unknown) {
  return function logFunction(_level: string, message: string, _meta: LogMeta | undefined) {
    const { dbType, dbMessage } = parseGraphileMigrateMessage(message)
    let prettyMessage = ''

    switch (dbType) {
      case 'shadow':
        assert(shadowDbUri !== undefined, 'SHADOW_DB_URI is required')
        prettyMessage = prettyDb(shadowDbUri)
        break
      case 'root':
        assert(rootDbUri !== undefined, 'ROOT_DB_URI is required')
        prettyMessage = prettyDb(rootDbUri)
        break
      default:
        assert(dbUri !== undefined, 'DB_URI is required')
        prettyMessage = prettyDb(dbUri)
    }

    console.log(`${GRAPHILE_MIGRATE} → ${prettyMessage}: ${dbMessage}`)
  }
}

const customLogger = new Logger(logFunctionFactory)

const graphileSettings: Settings = {
  connectionString: dbUri,
  shadowConnectionString: shadowDbUri,
  rootConnectionString: rootDbUri,
  migrationsFolder: processDir,
  logger: customLogger,
  afterReset: baselineFile || undefined
}

const migraImage = 'public.ecr.aws/supabase/migra:3.0.1663481299'

const runMigra = async (from: string, to: string): Promise<string> => {
  console.log(`🔍 Comparing ${prettyDb(from)} to ${prettyDb(to)} using ${MIGRA}...`);

  let revertSql = '';

  // Split the schemas string into an array
  const schemaList = schemas.split(',');

  try {
    for (const schema of schemaList) {
      console.log(`🔍 ${MIGRA} → Comparing schema: ${chalk.bold(schema.trim())}...`);
      const args = [
        'run',
        '--rm',
        '-i',
        '--network',
        'host',
        migraImage,
        'migra',
        from.replace('postgres://', 'postgresql://'),
        to.replace('postgres://', 'postgresql://'),
        '--with-privileges',
        '--unsafe',
        `--schema=${schema.trim()}` // Use the current schema in the loop
      ];
      const proc = spawnSync('docker', args);

      // Append the output of each schema to revertSql
      revertSql += proc.stdout.toString('utf8');
    }
  } catch (error) {
    console.error(`Error running ${MIGRA}:`, error);
  }

  return revertSql;
};

const fixDrift = async (): Promise<void> => {
  console.log(`🤔 Looking for drift...`)
  assert(shadowDbUri !== undefined, 'SHADOW_DB_URI is required')
  assert(dbUri !== undefined, 'DB_URI is required')
  const revertSql = await runMigra(dbUri, shadowDbUri)

  const pool = new Pool({
    connectionString: dbUri
  })

  const client = await pool.connect()

  if (revertSql) {
    console.log('🚨 Drift detected! Reverting database to shadow database state, sql below:')
    console.log(highlight(revertSql, highlightOptions))

    try {
      await client.query(revertSql)
    } catch (error) {
      console.error('Error executing SQL:', error)
    }
  } else {
    console.log('📢 No drift detected, no need to revert.')
  }

  client.release()
  await pool.end()
}

const getStatus = async (): Promise<void> => {
  console.log(`🚀 Checking migration status using ${GRAPHILE_MIGRATE}...`)
  const migrationStatus = await status(graphileSettings)

  const statusIcon = migrationStatus.remainingMigrations?.length === 0 ? '✅' : '🚨'
  process.stdout.write(`${statusIcon} Migration status: `)
  console.log(migrationStatus)
}

const runMigrations = async (): Promise<void> => {
  console.log(`🚀 Running migrations using ${GRAPHILE_MIGRATE}...`)
  await migrate(graphileSettings)
  assert(dbUri !== undefined, 'DB_URI is required')
  console.log(`✅ Migrations applied to ${prettyDb(dbUri)}.`)
}

const ormDone = async (): Promise<void> => {
  console.log(`🎉 ${ORM_NAME} finished!`)
  assert(shadowDbUri !== undefined, 'SHADOW_DB_URI is required')
  assert(ormDbUri !== undefined, 'ORM_DB_URI is required')
  let diffSql = await runMigra(shadowDbUri, ormDbUri)
  if (!diffSql) {
    diffSql = EMPTY_MIGRATION_TEXT
    console.log('📢 No migrations needed.')
  }

  // Check if file contents are different before writing
  let currentContent = ''
  if (fs.existsSync(CURRENT_FILE_PATH)) {
    currentContent = fs.readFileSync(CURRENT_FILE_PATH, 'utf-8')
  }

  if (currentContent !== diffSql) {
    console.log(`📜 See SQL below:`)
    console.log(highlight(diffSql, highlightOptions))

    fs.writeFileSync(CURRENT_FILE_PATH, diffSql)
    console.log(`✅ Updated ${CURRENT_SQL} migration file.`)
  } else {
    console.log(`📌 No changes needed in ${CURRENT_SQL}.`)
  }
}

const withClient = async (dbConnectionString: string, fn: (client: PoolClient) => Promise<void>): Promise<void> => {
  const pool = new Pool({
    connectionString: dbConnectionString
  })

  const client = await pool.connect()

  try {
    await fn(client)
  } catch (e) {
    console.error('Error executing SQL:', e)
  }

  client.release()
  await pool.end()
}

const waitForDb = async (dbConnectionString: string): Promise<void> => {
  console.log(`🔍 Checking availability for ${prettyDb(dbConnectionString)} ... `)

  const startTime = Date.now()
  const TIMEOUT_MS = 60 * 1000 // 1 minute in milliseconds

  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error(`🕐 Timeout: Unable to connect to ${prettyDb(dbConnectionString)} after 1 minute.`)
    }

    try {
      await withClient(dbConnectionString, async (client) => {
        await client.query('SELECT 1')
        console.log(`✅ ${prettyDb(dbConnectionString)} is available!`)
      })
      break
    } catch (e) {
      console.log(`🔴 ${prettyDb(dbConnectionString)} is not available yet, waiting 2 seconds...`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

const ensureDbExists = async (dbConnectionString: string): Promise<boolean> => {
  console.log(`🔍 Ensuring existence for ${prettyDb(dbConnectionString)} ... `)
  let wasCreated = false

  // If dbConnectionString is rootDbUri, we need to connect to the default postgres db
  assert(rootDbUri !== undefined, 'ROOT_DB_URI is required')
  assert(dbUri !== undefined, 'DB_URI is required')
  const uriToUse = dbConnectionString === rootDbUri ? dbUri : rootDbUri

  await withClient(uriToUse, async (client) => {
    let exists = false
    try {
      // Check if db exists first
      const { rows } = await client.query(
        `SELECT datname FROM pg_catalog.pg_database WHERE lower(datname) = lower('${getDbName(dbConnectionString)}')`
      )
      exists = rows.length > 0
    } catch (e) {
      exists = false
    }

    if (!exists) {
      await client.query(`CREATE DATABASE ${getDbName(dbConnectionString)}`)
      console.log(`🚀 ${prettyDb(dbConnectionString)} created!`)
      wasCreated = true
    } else {
      console.log(`✅ ${prettyDb(dbConnectionString)} exists.`)
    }
  })
  return wasCreated
}

const resetShadowDb = async (): Promise<void> => {
  assert(shadowDbUri !== undefined, 'SHADOW_DB_URI is required')
  console.log(`🚀 Resetting shadow database ${prettyDb(shadowDbUri)}...`)
  await reset(graphileSettings, true)
}

const commitMigration = async (description: string): Promise<void> => {
  console.log(`🚀 Committing migration using ${GRAPHILE_MIGRATE}...`)
  try {
    await resetShadowDb()
    await fixDrift()
    await commit(graphileSettings, description)
  } catch (e) {
    console.error('Error committing migration:', e)
  }
}

const uncommitMigration = async (): Promise<void> => {
  console.log(`🚀 Uncommitting migration using ${GRAPHILE_MIGRATE}...`)
  await uncommit(graphileSettings)
}

const runCurrent = async (): Promise<void> => {
  // Don't fix drift if we are not up to date with the shadow db
  const migrationStatus = await status(graphileSettings)
  if ((migrationStatus.remainingMigrations || []).length > 0) {
    console.log(`🚀 There are remaining migrations, running them first...`)
    await migrate(graphileSettings)
  }

  console.log(`🚀 Running current using ${GRAPHILE_MIGRATE}...`)
  await fixDrift()
  await watch(graphileSettings, true, false)
}

const q: queueAsPromised<Task> = fastq.promise(asyncWorker, 1)

async function asyncWorker(arg: Task): Promise<void> {
  await taskMap[arg.name].method(arg)
}

const runCommand = async (command: string | undefined, args: string): Promise<void> => {
  if (!command) {
    console.error(`❌ No command provided`)
    return
  }

  console.log(`📡 Migration server received command: ${chalk.bold.green(command)} with args: ${chalk.bold.green(args)}`)
  if (!(command in taskMap)) {
    console.error(`❌ Unknown command: ${chalk.bold.red(command)}`)
    process.exit(1)
  }
  const commandToRun = command as Task['name']
  await q.push({ name: commandToRun, args })
}

const main = async (): Promise<void> => {
  const command = process.argv[2]
  const rest = process.argv.slice(3)

  if (dbUri) {
    await waitForDb(dbUri)
  }

  if (command !== 'migrate' && command !== 'init') {
    // Migrate can be run without root db or shadow db
    assert(rootDbUri !== undefined, 'ROOT_DB_URI is required')
    assert(shadowDbUri !== undefined, 'SHADOW_DB_URI is required')
    await ensureDbExists(rootDbUri)
    await ensureDbExists(shadowDbUri)
  }

  if (command) {
    await runCommand(command, rest.join(' '))
    process.exit(0)
  }

  // Always reset shadow db on startup
  await resetShadowDb()

  console.log(`🚀 Watching migrations using ${GRAPHILE_MIGRATE}...`)

  const watcher = chokidar.watch(CURRENT_FILE_PATH, {
    /*
     * Without `usePolling`, on Linux, you can prevent the watching from
     * working by issuing `git stash && sleep 2 && git stash pop`. This is
     * annoying.
     */
    usePolling: true,

    /*
     * Some editors stream the writes out a little at a time, we want to wait
     * for the write to finish before triggering.
     */
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    },

    /*
     * We don't want to run the queue too many times during startup; so we
     * call it once on the 'ready' event.
     */
    ignoreInitial: true
  })
  watcher.on('add', () => q.push({ name: 'run_current' }))
  watcher.on('change', () => q.push({ name: 'run_current' }))
  watcher.on('unlink', () => q.push({ name: 'run_current' }))
  watcher.once('ready', () => q.push({ name: 'run_current' }))

  const server = net.createServer((socket) => {
    socket.on('data', async (data) => {
      const [command, ...rest] = data.toString().trim().split(' ')

      await runCommand(command, rest.join(' '))
    })
  })

  console.log(`📥 Pulling ${MIGRA} image...`)
  spawnSync('docker', ['pull', migraImage])

  assert(ormDbUri !== undefined, 'ORM_DB_URI is required')
  assert(shadowDbUri !== undefined, 'SHADOW_DB_URI is required')
  assert(rootDbUri !== undefined, 'ROOT_DB_URI is required')
  assert(dbUri !== undefined, 'DB_URI is required')
  const wasCreated = await ensureDbExists(ormDbUri)
  if (wasCreated) {
    // If we created, we can reset it as well
    console.log(`🚀 Resetting orm database ${prettyDb(ormDbUri)}...`)
    await reset(
      {
        ...graphileSettings,
        shadowConnectionString: ormDbUri
      },
      true
    )
  }

  server.listen(PORT, async () => {
    console.log(`📡 Migration server listening on port ${chalk.bold.green(PORT)}`)
    console.log(`
    Welcome to the Migration server! This server is used to generate migrations
    between the shadow database and the ${ORM_NAME} database. It can also be used to update
    your local database to the shadow database state including the current migration using
    ${GRAPHILE_MIGRATE}.
    
    ${chalk.bold('Managed schemas:')}
${schemas.split(',').map((s) => `${COMMAND_TAB_SPACING}* ${s}`).join('\n')}
    
    ${chalk.bold('root database:')} ${prettyDb(rootDbUri)}
      * This is the database that is used to create other databases.
    
    ${chalk.bold('app database:')} ${prettyDb(dbUri)}
      * This is the database that is used by the app.
    
    ${chalk.bold('orm database:')} ${prettyDb(ormDbUri)}
      * This is the database that is used by ${ORM_NAME}. It is always in sync with the
        ${ORM_NAME} models. When a change is made to the ${ORM_NAME} models, a
        migration is automatically generated.
    
    ${chalk.bold('shadow database:')} ${prettyDb(shadowDbUri)}
      * This is the database that is used by ${GRAPHILE_MIGRATE}. It is always in sync
        with the latest migrations ${chalk.italic.bold('excluding')} the current migration.
        
    To run a command, use the following syntax:
        ${chalk.bold.green('echo "command args" | nc localhost 5105')}
        or
        ${chalk.bold.green('migration-server command args')}
        
    Available commands:
${Object.entries(taskMap)
  .map(([, { usage, description }]) => {
    return `${COMMAND_TAB_SPACING}${usage}\n${description
      .map((d) => `${COMMAND_DESCRIPTION_TAB_SPACING}${d}`)
      .join('\n')}`
  })
  .join('\n\n')}
  `)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
