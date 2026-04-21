const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getOdbcModule() {
    try {
        return require('odbc');
    } catch (error) {
        throw new Error('The `odbc` package is not installed. Use flat-file audit output instead, or install `odbc` to enable Access writes.');
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

    return candidate;
}

function createAccessDatabaseFile(accessDbPath) {
    const resolvedPath = path.resolve(accessDbPath);
    const directory = path.dirname(resolvedPath);

    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }

    if (fs.existsSync(resolvedPath)) {
        return;
    }

    if (process.platform !== 'win32') {
        throw new Error(`Access file does not exist and auto-create is only supported on Windows: ${resolvedPath}`);
    }

    const escapedPath = resolvedPath.replace(/'/g, "''");
    const psScript = [
        "$ErrorActionPreference='Stop'",
        `$dbPath='${escapedPath}'`,
        "$providers=@('Microsoft.ACE.OLEDB.16.0','Microsoft.ACE.OLEDB.12.0')",
        "$created=$false",
        "foreach ($provider in $providers) {",
        "  try {",
        "    $catalog = New-Object -ComObject ADOX.Catalog",
        "    $catalog.Create(\"Provider=$provider;Data Source=$dbPath;Jet OLEDB:Engine Type=5;\")",
        "    $created=$true",
        "    break",
        "  } catch {",
        "    continue",
        "  }",
        "}",
        "if (-not $created) { throw 'Unable to create Access database. Ensure Microsoft Access Database Engine is installed.' }"
    ].join('; ');

    try {
        execFileSync('powershell', ['-NoProfile', '-Command', psScript], { stdio: 'pipe' });
    } catch (error) {
        const stderr = error && error.stderr ? String(error.stderr) : '';
        const stdout = error && error.stdout ? String(error.stdout) : '';
        const details = stderr || stdout || (error && error.message ? error.message : String(error));
        throw new Error(`Failed to create Access DB file at ${resolvedPath}. ${details}`);
    }

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Access DB creation did not produce a file: ${resolvedPath}`);
    }
}

async function initializeAccessAuditStore(accessDbPath, tableName, assessmentTableName) {
    createAccessDatabaseFile(accessDbPath);
    const connection = await openConnection(accessDbPath);

    try {
        await ensureAuditTable(connection, tableName);
        if (assessmentTableName) {
            await ensureAssessmentResultsTable(connection, assessmentTableName);
        }
    } finally {
        await connection.close();
    }
}

function getAccessConnectionString(accessDbPath) {
    return `Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=${accessDbPath};`;
}

async function openConnection(accessDbPath) {
    const resolvedPath = path.resolve(accessDbPath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Access database file not found: ${resolvedPath}. Create an empty .accdb file first.`);
    }

    const connectionString = getAccessConnectionString(resolvedPath);
    const odbc = getOdbcModule();
    return odbc.connect(connectionString);
}

async function ensureAuditTable(connection, tableName) {
    const safeTableName = normalizeTableName(tableName);
    const ddl = `
CREATE TABLE [${safeTableName}] (
    Id COUNTER PRIMARY KEY,
    RunId VARCHAR(64),
    RowNumber INTEGER,
    RequestTimestamp DATETIME,
    ResponseTimestamp DATETIME,
    DurationMs INTEGER,
    ApiUrl VARCHAR(255),
    MessageID VARCHAR(255),
    HttpStatus INTEGER,
    WasSuccess BIT,
    AttemptCount INTEGER,
    ErrorType VARCHAR(64),
    ErrorMessage LONGVARCHAR,
    RequestBody LONGVARCHAR,
    ResponseBody LONGVARCHAR
)`;

    // Check if table already exists before attempting CREATE
    try {
        await connection.query(`SELECT TOP 1 Id FROM [${safeTableName}]`);
        // Query succeeded — table already exists, nothing to do
        return;
    } catch (_) {
        // Table doesn't exist (or has no Id column) — proceed to create
    }

    await connection.query(ddl);
}

/**
 * Escape a value for inline Access SQL.
 * - null/undefined  → NULL
 * - Date            → #M/D/YYYY H:MM:SS# (Access date literal)
 * - string from ISO → converted to Date first, then same format
 * - number/boolean  → raw value
 * - other strings   → single-quoted with internal single-quotes doubled
 */
function toAccessSqlLiteral(value) {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (value instanceof Date) {
        const m = value.getMonth() + 1;
        const d = value.getDate();
        const y = value.getFullYear();
        const h = value.getHours();
        const min = String(value.getMinutes()).padStart(2, '0');
        const s = String(value.getSeconds()).padStart(2, '0');
        return `#${m}/${d}/${y} ${h}:${min}:${s}#`;
    }
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    // String — try to detect ISO timestamps
    const str = String(value);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str)) {
        const dt = new Date(str);
        if (!isNaN(dt.getTime())) {
            return toAccessSqlLiteral(dt);
        }
    }
    return `'${str.replace(/'/g, "''")}'`;
}

async function insertAuditRecord(connection, tableName, record) {
    const safeTableName = normalizeTableName(tableName);
    const sql = `
INSERT INTO [${safeTableName}] (
    RunId,
    RowNumber,
    RequestTimestamp,
    ResponseTimestamp,
    DurationMs,
    ApiUrl,
    MessageID,
    HttpStatus,
    WasSuccess,
    AttemptCount,
    ErrorType,
    ErrorMessage,
    RequestBody,
    ResponseBody
) VALUES (
    ${toAccessSqlLiteral(record.runId)},
    ${toAccessSqlLiteral(record.rowNumber)},
    ${toAccessSqlLiteral(record.requestTimestamp)},
    ${toAccessSqlLiteral(record.responseTimestamp)},
    ${toAccessSqlLiteral(record.durationMs)},
    ${toAccessSqlLiteral(record.apiUrl)},
    ${toAccessSqlLiteral(record.messageId)},
    ${toAccessSqlLiteral(record.httpStatus)},
    ${toAccessSqlLiteral(record.wasSuccess ? 1 : 0)},
    ${toAccessSqlLiteral(record.attemptCount)},
    ${toAccessSqlLiteral(record.errorType)},
    ${toAccessSqlLiteral(record.errorMessage)},
    ${toAccessSqlLiteral(record.requestBody)},
    ${toAccessSqlLiteral(record.responseBody)}
)`;

    await connection.query(sql);
}

async function ensureAssessmentResultsTable(connection, tableName) {
    const safeTableName = normalizeTableName(tableName);
    const ddl = `CREATE TABLE [${safeTableName}] (Id COUNTER PRIMARY KEY, MessageID TEXT(255), DataClass TEXT(255), AttributeName TEXT(255), AttributeValue LONGTEXT, Assessment TEXT(255), Status TEXT(50), Reason LONGTEXT, Effect LONGTEXT)`;

    // Check if table already exists before attempting CREATE
    try {
        await connection.query(`SELECT TOP 1 Id FROM [${safeTableName}]`);
        // Query succeeded — table already exists, nothing to do
        return;
    } catch (_) {
        // Table doesn't exist — proceed to create
    }

    await connection.query(ddl);
}

async function insertAssessmentResults(connection, tableName, assessmentRecords) {
    if (!assessmentRecords || assessmentRecords.length === 0) {
        return;
    }

    const safeTableName = normalizeTableName(tableName);

    for (const record of assessmentRecords) {
        const sql = `
INSERT INTO [${safeTableName}] (
    MessageID,
    DataClass,
    AttributeName,
    AttributeValue,
    Assessment,
    Status,
    Reason,
    Effect
) VALUES (
    ${toAccessSqlLiteral(record.messageId)},
    ${toAccessSqlLiteral(record.dataClass)},
    ${toAccessSqlLiteral(record.attributeName)},
    ${toAccessSqlLiteral(record.attributeValue)},
    ${toAccessSqlLiteral(record.assessment)},
    ${toAccessSqlLiteral(record.status)},
    ${toAccessSqlLiteral(record.reason)},
    ${toAccessSqlLiteral(record.effect)}
)`;
        await connection.query(sql);
    }
}

module.exports = {
    createAccessDatabaseFile,
    initializeAccessAuditStore,
    openConnection,
    ensureAuditTable,
    ensureAssessmentResultsTable,
    insertAuditRecord,
    insertAssessmentResults,
    normalizeTableName
};
