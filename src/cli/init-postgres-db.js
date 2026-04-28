const { createPool, initializePostgresAuditStore, normalizeTableName, getDefaultConnectionConfig } = require('../db/postgres-db');

function parseArgs(argv) {
    const options = {
        host: null,
        port: null,
        database: null,
        user: null,
        password: null,
        tableName: 'piqi_audit_log',
        assessmentTableName: 'piqi_assessment_results'
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;

        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            throw new Error(`Missing value for ${arg}`);
        }

        switch (arg) {
            case '--host':
                options.host = next;
                break;
            case '--port':
                options.port = parseInt(next, 10);
                break;
            case '--database':
                options.database = next;
                break;
            case '--user':
                options.user = next;
                break;
            case '--password':
                options.password = next;
                break;
            case '--table-name':
                options.tableName = next;
                break;
            case '--assessment-table-name':
                options.assessmentTableName = next;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }

        i += 1;
    }

    return options;
}

function validateOptions(options) {
    normalizeTableName(options.tableName);
    normalizeTableName(options.assessmentTableName);
}

function printUsage() {
    console.log('Usage: npm run init:postgres -- [options]');
    console.log('Creates the PostgreSQL tables if they do not exist.');
    console.log('');
    console.log('Options:');
    console.log('  --host <host>                      PostgreSQL host (default: localhost or PGHOST env)');
    console.log('  --port <port>                      PostgreSQL port (default: 5432 or PGPORT env)');
    console.log('  --database <name>                  Database name (default: piqi or PGDATABASE env)');
    console.log('  --user <user>                      Database user (default: postgres or PGUSER env)');
    console.log('  --password <password>              Database password (or PGPASSWORD env)');
    console.log('  --table-name <name>                Audit table name (default: piqi_audit_log)');
    console.log('  --assessment-table-name <name>     Assessment results table (default: piqi_assessment_results)');
    console.log('');
    console.log('Environment variables:');
    console.log('  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD');
}

(async function main() {
    let pool = null;
    
    try {
        const options = parseArgs(process.argv);
        validateOptions(options);

        const connectionConfig = {};
        if (options.host) connectionConfig.host = options.host;
        if (options.port) connectionConfig.port = options.port;
        if (options.database) connectionConfig.database = options.database;
        if (options.user) connectionConfig.user = options.user;
        if (options.password) connectionConfig.password = options.password;

        pool = createPool(connectionConfig);
        
        await initializePostgresAuditStore(pool, options.tableName, options.assessmentTableName);

        const effectiveConfig = { ...getDefaultConnectionConfig(), ...connectionConfig };
        
        console.log('PostgreSQL audit store initialized successfully.');
        console.log(`Host: ${effectiveConfig.host}:${effectiveConfig.port}`);
        console.log(`Database: ${effectiveConfig.database}`);
        console.log(`Audit Table: ${options.tableName}`);
        console.log(`Assessment Table: ${options.assessmentTableName}`);
    } catch (error) {
        console.error('Error:', error.message);
        printUsage();
        process.exitCode = 1;
    } finally {
        if (pool) {
            await pool.end();
        }
    }
}());
