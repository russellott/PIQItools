const fs = require('fs');
const path = require('path');

function ensureDirectory(dirPath) {
    const resolvedPath = path.resolve(dirPath);
    fs.mkdirSync(resolvedPath, { recursive: true });
    return resolvedPath;
}

function escapeCsv(value) {
    if (value === undefined || value === null) return '';
    const text = String(value);
    if (/[",\r\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
}

function serializeForFile(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function getFilePaths(outputDir, runId) {
    const resolvedDir = ensureDirectory(outputDir);
    return {
        directory: resolvedDir,
        jsonlPath: path.join(resolvedDir, `piqi-audit-${runId}.jsonl`),
        csvPath: path.join(resolvedDir, `piqi-audit-${runId}.csv`)
    };
}

function initializeFlatFileAudit(outputDir, runId) {
    const filePaths = getFilePaths(outputDir, runId);
    const csvHeader = [
        'runId',
        'rowNumber',
        'requestTimestamp',
        'responseTimestamp',
        'durationMs',
        'apiUrl',
        'messageId',
        'httpStatus',
        'wasSuccess',
        'attemptCount',
        'errorType',
        'errorMessage',
        'requestBody',
        'responseBody'
    ].join(',') + '\n';

    const csvStream = fs.createWriteStream(filePaths.csvPath, { flags: 'w', encoding: 'utf8' });
    const jsonlStream = fs.createWriteStream(filePaths.jsonlPath, { flags: 'w', encoding: 'utf8' });

    csvStream.write(csvHeader);

    return {
        ...filePaths,
        csvStream,
        jsonlStream
    };
}

function appendAuditRecord(filePaths, record) {
    const normalizedRecord = {
        runId: record.runId,
        rowNumber: record.rowNumber,
        requestTimestamp: record.requestTimestamp ? new Date(record.requestTimestamp).toISOString() : null,
        responseTimestamp: record.responseTimestamp ? new Date(record.responseTimestamp).toISOString() : null,
        durationMs: record.durationMs,
        apiUrl: record.apiUrl,
        messageId: record.messageId,
        httpStatus: record.httpStatus,
        wasSuccess: record.wasSuccess,
        attemptCount: record.attemptCount,
        errorType: record.errorType,
        errorMessage: record.errorMessage,
        requestBody: serializeForFile(record.requestBody),
        responseBody: serializeForFile(record.responseBody)
    };

    filePaths.jsonlStream.write(JSON.stringify(normalizedRecord) + '\n');

    const csvRow = [
        normalizedRecord.runId,
        normalizedRecord.rowNumber,
        normalizedRecord.requestTimestamp,
        normalizedRecord.responseTimestamp,
        normalizedRecord.durationMs,
        normalizedRecord.apiUrl,
        normalizedRecord.messageId,
        normalizedRecord.httpStatus,
        normalizedRecord.wasSuccess,
        normalizedRecord.attemptCount,
        normalizedRecord.errorType,
        normalizedRecord.errorMessage,
        normalizedRecord.requestBody,
        normalizedRecord.responseBody
    ].map(escapeCsv).join(',') + '\n';

    filePaths.csvStream.write(csvRow);
}

async function closeFlatFileAudit(filePaths) {
    if (!filePaths) return;

    const closeStream = stream => new Promise((resolve, reject) => {
        if (!stream) {
            resolve();
            return;
        }

        stream.end(error => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

    await Promise.all([
        closeStream(filePaths.csvStream),
        closeStream(filePaths.jsonlStream)
    ]);
}

module.exports = {
    appendAuditRecord,
    initializeFlatFileAudit,
    closeFlatFileAudit
};
