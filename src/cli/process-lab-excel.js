const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');

const { convertSpreadsheetRowToMessageData, buildPiqiValidationRequest } = require('../core/lab-piqi-core');
const { submitWithRetry } = require('../api/piqi-api');
const { initializeAccessAuditStore, openConnection: openAccessConnection, insertAuditRecord: insertAccessAuditRecord, insertAssessmentResults: insertAccessAssessmentResults, normalizeTableName } = require('../db/access-db');
const { createPool, initializePostgresAuditStore, insertAuditRecord: insertPgAuditRecord, insertAssessmentResults: insertPgAssessmentResults, normalizeTableName: normalizePgTableName } = require('../db/postgres-db');
const { appendAuditRecord, initializeFlatFileAudit, closeFlatFileAudit } = require('../audit/flat-file-audit');
const { extractAssessmentItems } = require('../audit/assessment-extractor');

function parseArgs(argv) {
    const options = {
        apiUrl: null,
        excelPath: null,
        accessDbPath: null,
        // PostgreSQL options
        pgHost: null,
        pgPort: null,
        pgDatabase: null,
        pgUser: null,
        pgPassword: null,
        auditOutputDir: null,
        worksheet: null,
        tableName: 'PiqiAuditLog',
        assessmentTableName: 'PiqiAssessmentResults',
        dataProviderID: null,
        dataSourceID: null,
        piqiModelMnemonic: 'PAT_CLINICAL_V1',
        evaluationRubricMnemonic: 'USCDI_V3',
        maxRetries: 1,
        retryDelayMs: 1000,
        startRow: 2,
        dryRun: false,
        benchmark: false,
        benchmarkOutput: null
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;

        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }

        if (arg === '--benchmark') {
            options.benchmark = true;
            continue;
        }

        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            throw new Error(`Missing value for ${arg}`);
        }

        switch (arg) {
            case '--api-url':
                options.apiUrl = next;
                break;
            case '--excel':
                options.excelPath = next;
                break;
            case '--access-db':
                options.accessDbPath = next;
                break;
            // PostgreSQL options
            case '--pg-host':
                options.pgHost = next;
                break;
            case '--pg-port':
                options.pgPort = parseInt(next, 10);
                break;
            case '--pg-database':
                options.pgDatabase = next;
                break;
            case '--pg-user':
                options.pgUser = next;
                break;
            case '--pg-password':
                options.pgPassword = next;
                break;
            case '--audit-output-dir':
                options.auditOutputDir = next;
                break;
            case '--worksheet':
                options.worksheet = next;
                break;
            case '--table-name':
                options.tableName = next;
                break;
            case '--assessment-table-name':
                options.assessmentTableName = next;
                break;
            case '--data-provider-id':
                options.dataProviderID = next;
                break;
            case '--data-source-id':
                options.dataSourceID = next;
                break;
            case '--piqi-model':
                options.piqiModelMnemonic = next;
                break;
            case '--rubric':
                options.evaluationRubricMnemonic = next;
                break;
            case '--max-retries':
                options.maxRetries = Number(next);
                break;
            case '--retry-delay-ms':
                options.retryDelayMs = Number(next);
                break;
            case '--start-row':
                options.startRow = Number(next);
                break;
            case '--benchmark-output':
                options.benchmarkOutput = next;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }

        i += 1;
    }

    return options;
}

function printUsage() {
    console.log('Usage: npm run process:lab -- --excel <file.xlsx> --api-url <url> --data-provider-id <id> --data-source-id <id> [options]');
    console.log('Options:');
    console.log('  --access-db <file.accdb>           Write audit records to Access');
    console.log('  --pg-host <host>                   PostgreSQL host (default: localhost or PGHOST env)');
    console.log('  --pg-port <port>                   PostgreSQL port (default: 5432 or PGPORT env)');
    console.log('  --pg-database <name>               PostgreSQL database (default: piqi or PGDATABASE env)');
    console.log('  --pg-user <user>                   PostgreSQL user (default: postgres or PGUSER env)');
    console.log('  --pg-password <password>           PostgreSQL password (or PGPASSWORD env)');
    console.log('  --audit-output-dir <dir>           Write audit records to flat files (JSONL + CSV)');
    console.log('  --worksheet <name>                 Worksheet name (default: first sheet)');
    console.log('  --table-name <name>                Audit table name (default: PiqiAuditLog / piqi_audit_log)');
    console.log('  --assessment-table-name <name>     Assessment results table (default: PiqiAssessmentResults / piqi_assessment_results)');
    console.log('  --piqi-model <mnemonic>       PIQI model mnemonic (default: PAT_CLINICAL_V1)');
    console.log('  --rubric <mnemonic>           Evaluation rubric mnemonic (default: USCDI_V3)');
    console.log('  --start-row <number>          1-based row index where data starts (default: 2)');
    console.log('  --max-retries <number>        Retry count for failed requests (default: 1)');
    console.log('  --retry-delay-ms <number>     Delay between retries in ms (default: 1000)');
    console.log('  --dry-run                     Build and log request data without API submission');
    console.log('  --benchmark                   Emit stage timing summary to console');
    console.log('  --benchmark-output <file>     Write benchmark JSON summary to file');
}

function usePostgres(options) {
    return !!(options.pgHost || options.pgPort || options.pgDatabase || options.pgUser || options.pgPassword ||
              process.env.PGHOST || process.env.PGDATABASE);
}

function validateOptions(options) {
    if (!options.excelPath) throw new Error('--excel is required');
    if (!options.dataProviderID) throw new Error('--data-provider-id is required');
    if (!options.dataSourceID) throw new Error('--data-source-id is required');
    if (!options.accessDbPath && !options.auditOutputDir && !usePostgres(options)) throw new Error('Provide at least one audit target: --access-db, --pg-host/--pg-database, and/or --audit-output-dir');
    if (!options.dryRun && !options.apiUrl) throw new Error('--api-url is required unless --dry-run is used');
    if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) throw new Error('--max-retries must be an integer >= 0');
    if (!Number.isInteger(options.retryDelayMs) || options.retryDelayMs < 0) throw new Error('--retry-delay-ms must be an integer >= 0');
    if (!Number.isInteger(options.startRow) || options.startRow < 1) throw new Error('--start-row must be an integer >= 1');
    if (options.accessDbPath) {
        normalizeTableName(options.tableName);
    }
    if (usePostgres(options)) {
        normalizePgTableName(options.tableName);
        normalizePgTableName(options.assessmentTableName);
    }
}

function readWorksheetRows(excelPath, worksheetName) {
    const resolvedPath = path.resolve(excelPath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Excel file not found: ${resolvedPath}`);
    }

    const workbook = xlsx.readFile(resolvedPath, { cellDates: false });
    const selectedSheetName = worksheetName || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[selectedSheetName];

    if (!worksheet) {
        throw new Error(`Worksheet not found: ${selectedSheetName}`);
    }

    return xlsx.utils.sheet_to_json(worksheet, {
        header: 1,
        blankrows: false,
        defval: ''
    });
}

function serializeBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') return body;
    return JSON.stringify(body);
}

async function processRows(options) {
    const runStartedAt = Date.now();
    const metrics = {
        excelReadMs: 0,
        accessInitMs: 0,
        messageBuildMs: 0,
        requestSerializeMs: 0,
        apiSubmitMs: 0,
        assessmentExtractMs: 0,
        accessWriteMs: 0,
        auditWriteMs: 0,
        closeResourcesMs: 0
    };

    const excelReadStartedAt = Date.now();
    const rows = readWorksheetRows(options.excelPath, options.worksheet);
    metrics.excelReadMs = Date.now() - excelReadStartedAt;
    const startIndex = options.startRow - 1;
    const dataRows = rows.slice(startIndex);

    if (dataRows.length === 0) {
        console.log('No data rows found from start row.');
        return;
    }

    const runId = crypto.randomBytes(12).toString('hex');
    let accessConnection = null;
    let pgPool = null;
    let pgClient = null;
    let flatFileAudit = null;

    // PostgreSQL table names (lowercase with underscores)
    const pgTableName = options.tableName.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    const pgAssessmentTableName = options.assessmentTableName.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

    if (options.accessDbPath) {
        const accessInitStartedAt = Date.now();
        await initializeAccessAuditStore(options.accessDbPath, options.tableName, options.assessmentTableName);
        accessConnection = await openAccessConnection(options.accessDbPath);
        metrics.accessInitMs = Date.now() - accessInitStartedAt;
    }

    if (usePostgres(options)) {
        const pgInitStartedAt = Date.now();
        const pgConfig = {};
        if (options.pgHost) pgConfig.host = options.pgHost;
        if (options.pgPort) pgConfig.port = options.pgPort;
        if (options.pgDatabase) pgConfig.database = options.pgDatabase;
        if (options.pgUser) pgConfig.user = options.pgUser;
        if (options.pgPassword) pgConfig.password = options.pgPassword;
        
        pgPool = createPool(pgConfig);
        await initializePostgresAuditStore(pgPool, pgTableName, pgAssessmentTableName);
        pgClient = await pgPool.connect();
        metrics.accessInitMs += Date.now() - pgInitStartedAt;
    }

    if (options.auditOutputDir) {
        flatFileAudit = initializeFlatFileAudit(options.auditOutputDir, runId);
    }

    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;

    try {
        for (let rowOffset = 0; rowOffset < dataRows.length; rowOffset += 1) {
            const worksheetRowNumber = startIndex + rowOffset + 1;
            const rowValues = dataRows[rowOffset];

            const messageBuildStartedAt = Date.now();
            const messageData = convertSpreadsheetRowToMessageData(rowValues, {
                dataProviderID: options.dataProviderID,
                dataSourceID: options.dataSourceID
            });

            const requestBody = buildPiqiValidationRequest({
                dataProviderID: options.dataProviderID,
                dataSourceID: options.dataSourceID,
                piqiModelMnemonic: options.piqiModelMnemonic,
                evaluationRubricMnemonic: options.evaluationRubricMnemonic,
                messageData
            });
            metrics.messageBuildMs += Date.now() - messageBuildStartedAt;

            const requestSerializeStartedAt = Date.now();
            const requestBodyText = JSON.stringify(requestBody);
            metrics.requestSerializeMs += Date.now() - requestSerializeStartedAt;

            let submissionResult;
            const apiSubmitStartedAt = Date.now();
            if (options.dryRun) {
                const now = new Date();
                submissionResult = {
                    requestTimestamp: now,
                    responseTimestamp: now,
                    attemptCount: 1,
                    statusCode: null,
                    isSuccess: true,
                    responseBodyText: 'DRY_RUN',
                    errorType: null,
                    errorMessage: null
                };
            } else {
                submissionResult = await submitWithRetry({
                    apiUrl: options.apiUrl,
                    requestBody,
                    requestBodyText,
                    maxRetries: options.maxRetries,
                    retryDelayMs: options.retryDelayMs
                });
            }
            metrics.apiSubmitMs += Date.now() - apiSubmitStartedAt;

            const durationMs = submissionResult.responseTimestamp.getTime() - submissionResult.requestTimestamp.getTime();

            const auditRecord = {
                runId,
                rowNumber: worksheetRowNumber,
                requestTimestamp: submissionResult.requestTimestamp,
                responseTimestamp: submissionResult.responseTimestamp,
                durationMs,
                apiUrl: options.apiUrl || 'DRY_RUN',
                messageId: requestBody.messageID,
                httpStatus: submissionResult.statusCode,
                wasSuccess: submissionResult.isSuccess,
                attemptCount: submissionResult.attemptCount,
                errorType: submissionResult.errorType,
                errorMessage: submissionResult.errorMessage,
                requestBody: requestBodyText,
                responseBody: serializeBody(submissionResult.responseBody)
            };

            if (accessConnection) {
                // DISABLED: await insertAccessAuditRecord(accessConnection, options.tableName, auditRecord);
                
                // Extract and log detailed assessment results if response is successful
                if (submissionResult.isSuccess && submissionResult.responseBodyText && submissionResult.responseBodyText !== 'DRY_RUN') {
                    const assessmentExtractStartedAt = Date.now();
                    const assessmentRecords = extractAssessmentItems(
                        requestBody.messageID,
                        submissionResult.responseBody
                    );
                    metrics.assessmentExtractMs += Date.now() - assessmentExtractStartedAt;

                    if (assessmentRecords.length > 0) {
                        const accessWriteStartedAt = Date.now();
                        await insertAccessAssessmentResults(accessConnection, options.assessmentTableName, assessmentRecords);
                        metrics.accessWriteMs += Date.now() - accessWriteStartedAt;
                    }
                }
            }

            if (pgClient) {
                // Insert audit record to PostgreSQL
                const pgWriteStartedAt = Date.now();
                await insertPgAuditRecord(pgClient, pgTableName, auditRecord);

                // Extract and log detailed assessment results if response is successful
                if (submissionResult.isSuccess && submissionResult.responseBodyText && submissionResult.responseBodyText !== 'DRY_RUN') {
                    const assessmentExtractStartedAt = Date.now();
                    const assessmentRecords = extractAssessmentItems(
                        requestBody.messageID,
                        submissionResult.responseBody
                    );
                    metrics.assessmentExtractMs += Date.now() - assessmentExtractStartedAt;

                    if (assessmentRecords.length > 0) {
                        await insertPgAssessmentResults(pgClient, pgAssessmentTableName, assessmentRecords);
                    }
                }
                metrics.accessWriteMs += Date.now() - pgWriteStartedAt;
            }

            if (flatFileAudit) {
                const auditWriteStartedAt = Date.now();
                appendAuditRecord(flatFileAudit, auditRecord);
                metrics.auditWriteMs += Date.now() - auditWriteStartedAt;
            }

            processedCount += 1;
            if (submissionResult.isSuccess) {
                successCount += 1;
            } else {
                failureCount += 1;
            }

            console.log(`[Row ${worksheetRowNumber}] ${submissionResult.isSuccess ? 'SUCCESS' : 'FAILED'} status=${submissionResult.statusCode ?? 'N/A'} attempts=${submissionResult.attemptCount}`);
        }

        console.log('Run complete.');
        console.log(`Run ID: ${runId}`);
        console.log(`Processed: ${processedCount}`);
        console.log(`Succeeded: ${successCount}`);
        console.log(`Failed: ${failureCount}`);
        if (options.accessDbPath) {
            console.log(`Access DB: ${path.resolve(options.accessDbPath)}`);
        }
        if (pgPool) {
            console.log(`PostgreSQL: ${options.pgHost || process.env.PGHOST || 'localhost'}:${options.pgPort || process.env.PGPORT || 5432}/${options.pgDatabase || process.env.PGDATABASE || 'piqi'}`);
        }
        if (flatFileAudit) {
            console.log(`Audit JSONL: ${flatFileAudit.jsonlPath}`);
            console.log(`Audit CSV: ${flatFileAudit.csvPath}`);
        }
    } finally {
        const closeStartedAt = Date.now();
        if (flatFileAudit) {
            await closeFlatFileAudit(flatFileAudit);
        }
        if (accessConnection) {
            await accessConnection.close();
        }
        if (pgClient) {
            pgClient.release();
        }
        if (pgPool) {
            await pgPool.end();
        }
        metrics.closeResourcesMs += Date.now() - closeStartedAt;
    }

    if (options.benchmark) {
        const totalRunMs = Date.now() - runStartedAt;
        const rowsPerSecond = totalRunMs > 0 ? Number(((processedCount * 1000) / totalRunMs).toFixed(2)) : 0;
        const summary = {
            runId,
            processed: processedCount,
            succeeded: successCount,
            failed: failureCount,
            totalRunMs,
            rowsPerSecond,
            avgApiSubmitMsPerRow: processedCount > 0 ? Number((metrics.apiSubmitMs / processedCount).toFixed(2)) : 0,
            stageMs: metrics
        };

        console.log('Benchmark summary:');
        console.log(JSON.stringify(summary));

        if (options.benchmarkOutput) {
            const resolvedBenchmarkPath = path.resolve(options.benchmarkOutput);
            const benchmarkDir = path.dirname(resolvedBenchmarkPath);
            fs.mkdirSync(benchmarkDir, { recursive: true });
            fs.writeFileSync(resolvedBenchmarkPath, JSON.stringify(summary, null, 2), 'utf8');
            console.log(`Benchmark JSON: ${resolvedBenchmarkPath}`);
        }
    }
}

(async function main() {
    try {
        const options = parseArgs(process.argv);
        validateOptions(options);
        await processRows(options);
    } catch (error) {
        console.error('Error:', error.message);
        printUsage();
        process.exitCode = 1;
    }
}());
