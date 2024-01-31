#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-misused-promises */
const path_1 = __importDefault(require("path"));
const net_1 = __importDefault(require("net"));
const fs_1 = __importDefault(require("fs"));
const cli_highlight_1 = require("cli-highlight");
const chalk_1 = __importDefault(require("chalk"));
const pg_1 = require("pg");
const graphile_migrate_1 = require("graphile-migrate");
const child_process_1 = require("child_process");
const assert_1 = __importDefault(require("assert"));
const dotenv = __importStar(require("dotenv"));
const logger_1 = require("@graphile/logger");
const chokidar_1 = __importDefault(require("chokidar"));
const fastq = __importStar(require("fastq"));
const processDir = process.cwd();
dotenv.config({
    path: path_1.default.join(processDir, '.env')
});
const PORT = 5105;
const dbUri = process.env.DB_URI;
const rootDbUri = process.env.ROOT_DB_URI;
const shadowDbUri = process.env.SHADOW_DB_URI;
const ormDbUri = process.env.ORM_DB_URI;
const ormName = process.env.ORM_NAME || 'ORM';
const baselineFile = process.env.BASELINE_FILE;
const schemas = process.env.SCHEMAS || 'public';
const CURRENT_FILE_PATH = path_1.default.join(processDir, 'current', '1-current.sql');
const GRAPHILE_MIGRATE = `💻 ${chalk_1.default.italic.hex('#ff795b')('Graphile Migrate')}`;
const MIGRA = chalk_1.default.italic.hex('#ff7d00')('Migra');
const ORM_NAME = chalk_1.default.italic.green(ormName);
const CURRENT_SQL = chalk_1.default.italic.cyan('current.sql');
const EMPTY_MIGRATION_TEXT = '-- Enter migration here\n';
const COMMAND_DESCRIPTION_TAB_SPACING = ' '.repeat(12);
const COMMAND_TAB_SPACING = ' '.repeat(8);
const getDbName = (dbUri) => {
    const url = new URL(dbUri);
    return url.pathname.slice(1);
};
const prettyDb = (dbUri) => {
    const dbName = getDbName(dbUri);
    if (dbUri === shadowDbUri) {
        return `👻 ${chalk_1.default.italic.yellow(dbName)}`;
    }
    if (dbUri === ormDbUri) {
        return `⚙️ ${chalk_1.default.italic.green(dbName)}`;
    }
    if (dbUri === rootDbUri) {
        return `🔑 ${chalk_1.default.italic.red(dbName)}`;
    }
    return `📦 ${chalk_1.default.italic.cyan(dbName)}`;
};
const highlightOptions = {
    language: 'sql',
    ignoreIllegals: true,
    theme: {
        keyword: chalk_1.default.yellow.bold,
        type: chalk_1.default.red.bold
    }
};
const taskMap = {
    commit: {
        usage: `${chalk_1.default.bold('commit')} ${chalk_1.default.yellow.italic('<description>')}`,
        description: [
            'Commits the current migration to the shadow database.',
            `Example: ${chalk_1.default.bold.green('commit Add users table')}`
        ],
        method: (task) => __awaiter(void 0, void 0, void 0, function* () {
            (0, assert_1.default)(task.name === 'commit');
            const description = task.args.trim();
            if (!description) {
                console.error(`❌ No description provided`);
                return;
            }
            yield commitMigration(description);
        })
    },
    uncommit: {
        usage: `${chalk_1.default.bold('uncommit')}`,
        description: ['Uncommits the last migration from the shadow database.'],
        method: () => __awaiter(void 0, void 0, void 0, function* () {
            yield uncommitMigration();
        })
    },
    run_current: {
        usage: `${chalk_1.default.bold('run_current')}`,
        description: ['Runs the current migration on the local database.'],
        method: () => __awaiter(void 0, void 0, void 0, function* () {
            yield runCurrent();
        })
    },
    orm_done: {
        usage: `${chalk_1.default.bold('orm_done')}`,
        description: [
            `Called by ${ORM_NAME} when it has finished generating a migration.`,
            `This will update the current migration file with the migration generated by ${ORM_NAME}.`,
            `This will also run the migration on the shadow database.`
        ],
        method: () => __awaiter(void 0, void 0, void 0, function* () {
            yield ormDone();
        })
    },
    migrate: {
        usage: `${chalk_1.default.bold('migrate')}`,
        description: ['Runs all migrations on the local database.'],
        method: () => __awaiter(void 0, void 0, void 0, function* () {
            yield runMigrations();
        })
    },
    reset_shadow: {
        usage: `${chalk_1.default.bold('reset_shadow')}`,
        description: ['Resets the shadow database to the state of the local database.'],
        method: () => __awaiter(void 0, void 0, void 0, function* () {
            yield resetShadowDb();
        })
    },
    status: {
        usage: `${chalk_1.default.bold('status')}`,
        description: ['Shows the status of the migrations.'],
        method: () => __awaiter(void 0, void 0, void 0, function* () {
            yield getStatus();
        })
    },
    init: {
        usage: `${chalk_1.default.bold('init')}`,
        description: ['Initializes the migration server.'],
        method: () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, graphile_migrate_1.init)({
                folder: true
            });
            // This will create a "./migrations" folder, we need to move everything up one level to ".".
            const migrationsFolder = path_1.default.join('.', 'migrations');
            const files = fs_1.default.readdirSync(migrationsFolder);
            files.forEach(file => {
                fs_1.default.renameSync(path_1.default.join(migrationsFolder, file), path_1.default.join('.', file));
            });
            fs_1.default.rmdirSync(migrationsFolder);
            // Open up the file ./.gmrc and replace the following: ./migrations with './'
            const gmrcFile = path_1.default.join('.', '.gmrc');
            const initConfig = Object.assign(Object.assign({}, graphileSettings), { migrationsFolder: './', logger: undefined });
            fs_1.default.writeFileSync(gmrcFile, JSON.stringify(initConfig, null, 2));
        })
    }
};
const parseGraphileMigrateMessage = (message) => {
    // Can be one of:
    // graphile-migrate[shadow]: <message>
    // graphile-migrate: <message> (default to db instead of shadow)
    const messageParts = message.match(/graphile-migrate(\[(.*)])?: (.*)/);
    const dbType = (messageParts === null || messageParts === void 0 ? void 0 : messageParts[2]) || 'db';
    const dbMessage = (messageParts === null || messageParts === void 0 ? void 0 : messageParts[3]) || message;
    return {
        dbType,
        dbMessage
    };
};
function logFunctionFactory(_scope) {
    return function logFunction(_level, message, _meta) {
        const { dbType, dbMessage } = parseGraphileMigrateMessage(message);
        let prettyMessage = '';
        switch (dbType) {
            case 'shadow':
                (0, assert_1.default)(shadowDbUri !== undefined, 'SHADOW_DB_URI is required');
                prettyMessage = prettyDb(shadowDbUri);
                break;
            case 'root':
                (0, assert_1.default)(rootDbUri !== undefined, 'ROOT_DB_URI is required');
                prettyMessage = prettyDb(rootDbUri);
                break;
            default:
                (0, assert_1.default)(dbUri !== undefined, 'DB_URI is required');
                prettyMessage = prettyDb(dbUri);
        }
        console.log(`${GRAPHILE_MIGRATE} → ${prettyMessage}: ${dbMessage}`);
    };
}
const customLogger = new logger_1.Logger(logFunctionFactory);
const graphileSettings = {
    connectionString: dbUri,
    shadowConnectionString: shadowDbUri,
    rootConnectionString: rootDbUri,
    migrationsFolder: processDir,
    logger: customLogger,
    afterReset: baselineFile || undefined
};
const migraImage = 'public.ecr.aws/supabase/migra:3.0.1663481299';
const runMigra = (from, to) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🔍 Comparing ${prettyDb(from)} to ${prettyDb(to)} using ${MIGRA}...`);
    let revertSql = '';
    // Split the schemas string into an array
    const schemaList = schemas.split(',');
    try {
        for (const schema of schemaList) {
            console.log(`🔍 ${MIGRA} → Comparing schema: ${chalk_1.default.bold(schema.trim())}...`);
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
            const proc = (0, child_process_1.spawnSync)('docker', args);
            // Append the output of each schema to revertSql
            revertSql += proc.stdout.toString('utf8');
        }
    }
    catch (error) {
        console.error(`Error running ${MIGRA}:`, error);
    }
    return revertSql;
});
const fixDrift = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🤔 Looking for drift...`);
    (0, assert_1.default)(shadowDbUri !== undefined, 'SHADOW_DB_URI is required');
    (0, assert_1.default)(dbUri !== undefined, 'DB_URI is required');
    const revertSql = yield runMigra(dbUri, shadowDbUri);
    const pool = new pg_1.Pool({
        connectionString: dbUri
    });
    const client = yield pool.connect();
    if (revertSql) {
        console.log('🚨 Drift detected! Reverting database to shadow database state, sql below:');
        console.log((0, cli_highlight_1.highlight)(revertSql, highlightOptions));
        try {
            yield client.query(revertSql);
        }
        catch (error) {
            console.error('Error executing SQL:', error);
        }
    }
    else {
        console.log('📢 No drift detected, no need to revert.');
    }
    client.release();
    yield pool.end();
});
const getStatus = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    console.log(`🚀 Checking migration status using ${GRAPHILE_MIGRATE}...`);
    const migrationStatus = yield (0, graphile_migrate_1.status)(graphileSettings);
    const statusIcon = ((_a = migrationStatus.remainingMigrations) === null || _a === void 0 ? void 0 : _a.length) === 0 ? '✅' : '🚨';
    process.stdout.write(`${statusIcon} Migration status: `);
    console.log(migrationStatus);
});
const runMigrations = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🚀 Running migrations using ${GRAPHILE_MIGRATE}...`);
    yield (0, graphile_migrate_1.migrate)(graphileSettings);
    (0, assert_1.default)(dbUri !== undefined, 'DB_URI is required');
    console.log(`✅ Migrations applied to ${prettyDb(dbUri)}.`);
});
const ormDone = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🎉 ${ORM_NAME} finished!`);
    (0, assert_1.default)(shadowDbUri !== undefined, 'SHADOW_DB_URI is required');
    (0, assert_1.default)(ormDbUri !== undefined, 'ORM_DB_URI is required');
    let diffSql = yield runMigra(shadowDbUri, ormDbUri);
    if (!diffSql) {
        diffSql = EMPTY_MIGRATION_TEXT;
        console.log('📢 No migrations needed.');
    }
    // Check if file contents are different before writing
    let currentContent = '';
    if (fs_1.default.existsSync(CURRENT_FILE_PATH)) {
        currentContent = fs_1.default.readFileSync(CURRENT_FILE_PATH, 'utf-8');
    }
    if (currentContent !== diffSql) {
        console.log(`📜 See SQL below:`);
        console.log((0, cli_highlight_1.highlight)(diffSql, highlightOptions));
        fs_1.default.writeFileSync(CURRENT_FILE_PATH, diffSql);
        console.log(`✅ Updated ${CURRENT_SQL} migration file.`);
    }
    else {
        console.log(`📌 No changes needed in ${CURRENT_SQL}.`);
    }
});
const withClient = (dbConnectionString, fn) => __awaiter(void 0, void 0, void 0, function* () {
    const pool = new pg_1.Pool({
        connectionString: dbConnectionString
    });
    const client = yield pool.connect();
    try {
        yield fn(client);
    }
    catch (e) {
        console.error('Error executing SQL:', e);
    }
    client.release();
    yield pool.end();
});
const waitForDb = (dbConnectionString) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🔍 Checking availability for ${prettyDb(dbConnectionString)} ... `);
    const startTime = Date.now();
    const TIMEOUT_MS = 60 * 1000; // 1 minute in milliseconds
    while (true) {
        if (Date.now() - startTime > TIMEOUT_MS) {
            throw new Error(`🕐 Timeout: Unable to connect to ${prettyDb(dbConnectionString)} after 1 minute.`);
        }
        try {
            yield withClient(dbConnectionString, (client) => __awaiter(void 0, void 0, void 0, function* () {
                yield client.query('SELECT 1');
                console.log(`✅ ${prettyDb(dbConnectionString)} is available!`);
            }));
            break;
        }
        catch (e) {
            console.log(`🔴 ${prettyDb(dbConnectionString)} is not available yet, waiting 2 seconds...`);
            yield new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
});
const ensureDbExists = (dbConnectionString) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🔍 Ensuring existence for ${prettyDb(dbConnectionString)} ... `);
    let wasCreated = false;
    // If dbConnectionString is rootDbUri, we need to connect to the default postgres db
    (0, assert_1.default)(rootDbUri !== undefined, 'ROOT_DB_URI is required');
    (0, assert_1.default)(dbUri !== undefined, 'DB_URI is required');
    const uriToUse = dbConnectionString === rootDbUri ? dbUri : rootDbUri;
    yield withClient(uriToUse, (client) => __awaiter(void 0, void 0, void 0, function* () {
        let exists = false;
        try {
            // Check if db exists first
            const { rows } = yield client.query(`SELECT datname FROM pg_catalog.pg_database WHERE lower(datname) = lower('${getDbName(dbConnectionString)}')`);
            exists = rows.length > 0;
        }
        catch (e) {
            exists = false;
        }
        if (!exists) {
            yield client.query(`CREATE DATABASE ${getDbName(dbConnectionString)}`);
            console.log(`🚀 ${prettyDb(dbConnectionString)} created!`);
            wasCreated = true;
        }
        else {
            console.log(`✅ ${prettyDb(dbConnectionString)} exists.`);
        }
    }));
    return wasCreated;
});
const resetShadowDb = () => __awaiter(void 0, void 0, void 0, function* () {
    (0, assert_1.default)(shadowDbUri !== undefined, 'SHADOW_DB_URI is required');
    console.log(`🚀 Resetting shadow database ${prettyDb(shadowDbUri)}...`);
    yield (0, graphile_migrate_1.reset)(graphileSettings, true);
});
const commitMigration = (description) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🚀 Committing migration using ${GRAPHILE_MIGRATE}...`);
    try {
        yield resetShadowDb();
        yield fixDrift();
        yield (0, graphile_migrate_1.commit)(graphileSettings, description);
    }
    catch (e) {
        console.error('Error committing migration:', e);
    }
});
const uncommitMigration = () => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`🚀 Uncommitting migration using ${GRAPHILE_MIGRATE}...`);
    yield (0, graphile_migrate_1.uncommit)(graphileSettings);
});
const runCurrent = () => __awaiter(void 0, void 0, void 0, function* () {
    // Don't fix drift if we are not up to date with the shadow db
    const migrationStatus = yield (0, graphile_migrate_1.status)(graphileSettings);
    if ((migrationStatus.remainingMigrations || []).length > 0) {
        console.log(`🚀 There are remaining migrations, running them first...`);
        yield (0, graphile_migrate_1.migrate)(graphileSettings);
    }
    console.log(`🚀 Running current using ${GRAPHILE_MIGRATE}...`);
    yield fixDrift();
    yield (0, graphile_migrate_1.watch)(graphileSettings, true, false);
});
const q = fastq.promise(asyncWorker, 1);
function asyncWorker(arg) {
    return __awaiter(this, void 0, void 0, function* () {
        yield taskMap[arg.name].method(arg);
    });
}
const runCommand = (command, args) => __awaiter(void 0, void 0, void 0, function* () {
    if (!command) {
        console.error(`❌ No command provided`);
        return;
    }
    console.log(`📡 Migration server received command: ${chalk_1.default.bold.green(command)} with args: ${chalk_1.default.bold.green(args)}`);
    if (!(command in taskMap)) {
        console.error(`❌ Unknown command: ${chalk_1.default.bold.red(command)}`);
        process.exit(1);
    }
    const commandToRun = command;
    yield q.push({ name: commandToRun, args });
});
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    const command = process.argv[2];
    const rest = process.argv.slice(3);
    if (dbUri) {
        yield waitForDb(dbUri);
    }
    if (command !== 'migrate' && command !== 'init') {
        // Migrate can be run without root db or shadow db
        (0, assert_1.default)(rootDbUri !== undefined, 'ROOT_DB_URI is required');
        (0, assert_1.default)(shadowDbUri !== undefined, 'SHADOW_DB_URI is required');
        yield ensureDbExists(rootDbUri);
        yield ensureDbExists(shadowDbUri);
    }
    if (command) {
        yield runCommand(command, rest.join(' '));
        process.exit(0);
    }
    // Always reset shadow db on startup
    yield resetShadowDb();
    console.log(`🚀 Watching migrations using ${GRAPHILE_MIGRATE}...`);
    const watcher = chokidar_1.default.watch(CURRENT_FILE_PATH, {
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
    });
    watcher.on('add', () => q.push({ name: 'run_current' }));
    watcher.on('change', () => q.push({ name: 'run_current' }));
    watcher.on('unlink', () => q.push({ name: 'run_current' }));
    watcher.once('ready', () => q.push({ name: 'run_current' }));
    const server = net_1.default.createServer((socket) => {
        socket.on('data', (data) => __awaiter(void 0, void 0, void 0, function* () {
            const [command, ...rest] = data.toString().trim().split(' ');
            yield runCommand(command, rest.join(' '));
        }));
    });
    console.log(`📥 Pulling ${MIGRA} image...`);
    (0, child_process_1.spawnSync)('docker', ['pull', migraImage]);
    (0, assert_1.default)(ormDbUri !== undefined, 'ORM_DB_URI is required');
    (0, assert_1.default)(shadowDbUri !== undefined, 'SHADOW_DB_URI is required');
    (0, assert_1.default)(rootDbUri !== undefined, 'ROOT_DB_URI is required');
    (0, assert_1.default)(dbUri !== undefined, 'DB_URI is required');
    const wasCreated = yield ensureDbExists(ormDbUri);
    if (wasCreated) {
        // If we created, we can reset it as well
        console.log(`🚀 Resetting orm database ${prettyDb(ormDbUri)}...`);
        yield (0, graphile_migrate_1.reset)(Object.assign(Object.assign({}, graphileSettings), { shadowConnectionString: ormDbUri }), true);
    }
    server.listen(PORT, () => __awaiter(void 0, void 0, void 0, function* () {
        console.log(`📡 Migration server listening on port ${chalk_1.default.bold.green(PORT)}`);
        console.log(`
    Welcome to the Migration server! This server is used to generate migrations
    between the shadow database and the ${ORM_NAME} database. It can also be used to update
    your local database to the shadow database state including the current migration using
    ${GRAPHILE_MIGRATE}.
    
    ${chalk_1.default.bold('Managed schemas:')}
${schemas.split(',').map((s) => `${COMMAND_TAB_SPACING}* ${s}`).join('\n')}
    
    ${chalk_1.default.bold('root database:')} ${prettyDb(rootDbUri)}
      * This is the database that is used to create other databases.
    
    ${chalk_1.default.bold('app database:')} ${prettyDb(dbUri)}
      * This is the database that is used by the app.
    
    ${chalk_1.default.bold('orm database:')} ${prettyDb(ormDbUri)}
      * This is the database that is used by ${ORM_NAME}. It is always in sync with the
        ${ORM_NAME} models. When a change is made to the ${ORM_NAME} models, a
        migration is automatically generated.
    
    ${chalk_1.default.bold('shadow database:')} ${prettyDb(shadowDbUri)}
      * This is the database that is used by ${GRAPHILE_MIGRATE}. It is always in sync
        with the latest migrations ${chalk_1.default.italic.bold('excluding')} the current migration.
        
    To run a command, use the following syntax:
        ${chalk_1.default.bold.green('echo "command args" | nc localhost 5105')}
        or
        ${chalk_1.default.bold.green('migration-server command args')}
        
    Available commands:
${Object.entries(taskMap)
            .map(([, { usage, description }]) => {
            return `${COMMAND_TAB_SPACING}${usage}\n${description
                .map((d) => `${COMMAND_DESCRIPTION_TAB_SPACING}${d}`)
                .join('\n')}`;
        })
            .join('\n\n')}
  `);
    }));
});
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=migraphile.js.map