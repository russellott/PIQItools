const fs = require('fs');
const path = require('path');

function getPoolModule() {
    try {
        return require('pg').Pool;
    } catch (error) {
        throw new Error('The `pg` package is not installed. Run `npm install pg` to enable PostgreSQL support.');
    }
}

function normalizeTableName(tableName) {
    const candidate = (tableName || '').trim();
    if (!candidate) {
        throw new Error('Table name is required.');
    }

    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(candidate)) {
        throw new Error(`Invalid table name: ${candidate}. Use letters, numbers, and underscore only.`);
    }

    return candidate.toLowerCase();
}

/**
 * Get default connection config from environment variables or use defaults
 */
function getDefaultConnectionConfig() {
    return {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        database: process.env.PGDATABASE || 'piqi',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || ''
    };
}

/**
 * Create a connection pool to PostgreSQL
 * @param {Object} config - Connection configuration (host, port, database, user, password)
 * @returns {Pool} - PostgreSQL connection pool
 */
function createPool(config = {}) {
    const Pool = getPoolModule();
    const connectionConfig = { ...getDefaultConnectionConfig(), ...config };
    return new Pool(connectionConfig);
}

/**
 * Open a single client connection from pool
 * @param {Pool} pool - PostgreSQL pool
 * @returns {Promise<Client>} - Connected client
 */
async function openConnection(pool) {
    const client = await pool.connect();
    return client;
}

/**
 * Initialize PostgreSQL audit store - ensures tables exist
 * @param {Pool} pool - PostgreSQL pool
 * @param {string} tableName - Audit log table name
 * @param {string} assessmentTableName - Assessment results table name (optional)
 */
async function initializePostgresAuditStore(pool, tableName, assessmentTableName) {
    const client = await pool.connect();
    try {
        await ensureAuditTable(client, tableName);
        if (assessmentTableName) {
            await ensureAssessmentResultsTable(client, assessmentTableName);
        }
    } finally {
        client.release();
    }
}

/**
 * Ensure the audit table exists
 * @param {Client} client - PostgreSQL client
 * @param {string} tableName - Table name
 */
async function ensureAuditTable(client, tableName) {
    const safeTableName = normalizeTableName(tableName);
    
    const ddl = `
CREATE TABLE IF NOT EXISTS ${safeTableName} (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(64),
    row_number INTEGER,
    request_timestamp TIMESTAMP,
    response_timestamp TIMESTAMP,
    duration_ms INTEGER,
    api_url VARCHAR(255),
    message_id VARCHAR(255),
    http_status INTEGER,
    was_success BOOLEAN,
    attempt_count INTEGER,
    error_type VARCHAR(64),
    error_message TEXT,
    request_body TEXT,
    response_body TEXT
)`;

    await client.query(ddl);
}

/**
 * Ensure the assessment results table exists
 * @param {Client} client - PostgreSQL client
 * @param {string} tableName - Table name
 */
async function ensureAssessmentResultsTable(client, tableName) {
    const safeTableName = normalizeTableName(tableName);
    
    const ddl = `
CREATE TABLE IF NOT EXISTS ${safeTableName} (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(255),
    data_class VARCHAR(255),
    attribute_name VARCHAR(255),
    attribute_value TEXT,
    assessment VARCHAR(255),
    status VARCHAR(50),
    reason TEXT,
    effect TEXT
)`;

    await client.query(ddl);
}

/**
 * Insert an audit record
 * @param {Client} client - PostgreSQL client
 * @param {string} tableName - Table name
 * @param {Object} record - Audit record to insert
 */
async function insertAuditRecord(client, tableName, record) {
    const safeTableName = normalizeTableName(tableName);
    
    const sql = `
INSERT INTO ${safeTableName} (
    run_id,
    row_number,
    request_timestamp,
    response_timestamp,
    duration_ms,
    api_url,
    message_id,
    http_status,
    was_success,
    attempt_count,
    error_type,
    error_message,
    request_body,
    response_body
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`;

    const values = [
        record.runId,
        record.rowNumber,
        record.requestTimestamp,
        record.responseTimestamp,
        record.durationMs,
        record.apiUrl,
        record.messageId,
        record.httpStatus,
        record.wasSuccess,
        record.attemptCount,
        record.errorType,
        record.errorMessage,
        record.requestBody,
        record.responseBody
    ];

    await client.query(sql, values);
}

/**
 * Insert assessment results
 * @param {Client} client - PostgreSQL client
 * @param {string} tableName - Table name
 * @param {Array} assessmentRecords - Array of assessment records
 */
async function insertAssessmentResults(client, tableName, assessmentRecords) {
    if (!assessmentRecords || assessmentRecords.length === 0) {
        return;
    }

    const safeTableName = normalizeTableName(tableName);

    const sql = `
INSERT INTO ${safeTableName} (
    message_id,
    data_class,
    attribute_name,
    attribute_value,
    assessment,
    status,
    reason,
    effect
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

    for (const record of assessmentRecords) {
        const values = [
            record.messageId,
            record.dataClass,
            record.attributeName,
            record.attributeValue,
            record.assessment,
            record.status,
            record.reason,
            record.effect
        ];
        await client.query(sql, values);
    }
}

/**
 * Run the schema.sql file to initialize all tables
 * @param {Pool} pool - PostgreSQL pool
 */
async function runSchemaFile(pool) {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    
    const client = await pool.connect();
    try {
        await client.query(schemaSql);
    } finally {
        client.release();
    }
}

module.exports = {
    createPool,
    openConnection,
    initializePostgresAuditStore,
    ensureAuditTable,
    ensureAssessmentResultsTable,
    insertAuditRecord,
    insertAssessmentResults,
    normalizeTableName,
    getDefaultConnectionConfig,
    runSchemaFile
};
