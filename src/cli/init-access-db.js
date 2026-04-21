const path = require('path');
const { initializeAccessAuditStore, normalizeTableName } = require('../db/access-db');

function parseArgs(argv) {
    const options = {
        accessDbPath: null,
        tableName: 'PiqiAuditLog'
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;

        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            throw new Error(`Missing value for ${arg}`);
        }

        switch (arg) {
            case '--access-db':
                options.accessDbPath = next;
                break;
            case '--table-name':
                options.tableName = next;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }

        i += 1;
    }

    return options;
}

function validateOptions(options) {
    if (!options.accessDbPath) {
        throw new Error('--access-db is required');
    }

    normalizeTableName(options.tableName);
}

function printUsage() {
    console.log('Usage: npm run init:access -- --access-db <file.accdb> [--table-name <name>]');
    console.log('Creates the .accdb file if missing and ensures the audit table exists.');
}

(async function main() {
    try {
        const options = parseArgs(process.argv);
        validateOptions(options);

        await initializeAccessAuditStore(options.accessDbPath, options.tableName);

        console.log('Access audit store initialized successfully.');
        console.log(`Database: ${path.resolve(options.accessDbPath)}`);
        console.log(`Table: ${options.tableName}`);
    } catch (error) {
        console.error('Error:', error.message);
        printUsage();
        process.exitCode = 1;
    }
}());
