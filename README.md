# PIQItools
PIQI utilities for community usage.

## Lab Excel Batch Utility (Node.js)

This repository now includes a batch utility to:

1. Read lab data rows from an Excel workbook.
2. Convert each row to a PIQI message using the same mapping pattern as `convertSpreadsheetToJSON()` in `SimpleLabPIQIClient.html`.
3. Build a PIQI validation request body using the same envelope shape as the page `buildRequestBody()` function.
4. Submit each row request to a PIQI API endpoint.
5. Capture API response payload/status.
6. Persist request/response + metadata to a local MS Access table.

If direct Access writes are not available, the utility can also write flat audit files for later import.

### Files

- `src/core/lab-piqi-core.js` - row conversion + request body builder.
- `src/cli/process-lab-excel.js` - CLI runner for batch processing.
- `src/api/piqi-api.js` - API submission with retry support.
- `src/db/access-db.js` - MS Access connection, schema bootstrap, inserts.
- `src/audit/flat-file-audit.js` - JSONL + CSV audit file output.
- `src/audit/assessment-extractor.js` - Detailed assessment results extract from PIQI responses.

### Prerequisites

- Windows with Node.js 18+.
- `xlsx` is required for Excel input.
- `odbc` is optional and only required for direct Access writes.
- Microsoft Access ODBC driver installed (ACE ODBC driver) for direct Access writes.
- Microsoft Access Database Engine provider installed for `.accdb` creation (ACE OLEDB provider) when using the init command.

### Install

```bash
npm install
```

### Run (submit mode)

```bash
npm run process:lab -- \
	--excel "C:\\data\\lab-input.xlsx" \
	--worksheet "Sheet1" \
	--api-url "http://localhost:5025/PIQI/ScoreAuditMessage" \
	--access-db "C:\\data\\piqi-audit.accdb" \
	--data-provider-id "Session ID ABC123" \
	--data-source-id "Session ID ABC123" \
	--piqi-model "PAT_CLINICAL_V1" \
	--rubric "USCDI_V3" \
	--start-row 2 \
	--max-retries 1 \
	--retry-delay-ms 1000
```

### Run with flat-file audit output only

Use this mode if `odbc` cannot be installed. It writes one JSONL file and one CSV file per run.

```bash
npm run process:lab -- \
	--excel "C:\\data\\lab-input.xlsx" \
	--audit-output-dir "C:\\data\\piqi-audit-files" \
	--api-url "http://localhost:5025/PIQI/ScoreAuditMessage" \
	--data-provider-id "Session ID ABC123" \
	--data-source-id "Session ID ABC123"
```

### Run with both Access and flat-file audit output

```bash
npm run process:lab -- \
	--excel "C:\\data\\lab-input.xlsx" \
	--access-db "C:\\data\\piqi-audit.accdb" \
	--audit-output-dir "C:\\data\\piqi-audit-files" \
	--api-url "http://localhost:5025/PIQI/ScoreAuditMessage" \
	--data-provider-id "Session ID ABC123" \
	--data-source-id "Session ID ABC123"
```

### Initialize Access DB/Table (recommended first step)

Creates the `.accdb` file if it does not exist and ensures the audit table exists.

```bash
npm run init:access -- \
	--access-db "C:\\data\\piqi-audit.accdb" \
	--table-name "PiqiAuditLog"
```

### Create Access DB directly from PowerShell

If you do not want to use Node/npm, run the standalone PowerShell script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-access-db.ps1 -AccessDbPath "C:\data\piqi-audit.accdb"
```

Create the DB and the audit table in one step:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-access-db.ps1 -AccessDbPath "C:\data\piqi-audit.accdb" -TableName "PiqiAuditLog"
```

Overwrite an existing database file:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-access-db.ps1 -AccessDbPath "C:\data\piqi-audit.accdb" -TableName "PiqiAuditLog" -Force
```

### Run end-to-end with PowerShell only (no npm)

If `npm` is blocked, use the standalone PowerShell processor:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\process-lab-data.ps1 `
	-InputPath "C:\data\lab-input.xlsx" `
	-Worksheet "Sheet1" `
	-StartRow 2 `
	-ApiUrl "http://localhost:5025/PIQI/ScoreAuditMessage" `
	-DataProviderID "Session ID ABC123" `
	-DataSourceID "Session ID ABC123" `
	-PiqiModelMnemonic "PAT_CLINICAL_V1" `
	-EvaluationRubricMnemonic "USCDI_V3" `
	-MaxRetries 1 `
	-RetryDelayMs 1000 `
	-AuditOutputDir "C:\data\piqi-audit-files"
```

To also write directly into Access (no `odbc` package required):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\process-lab-data.ps1 `
	-InputPath "C:\data\lab-input.xlsx" `
	-Worksheet "Sheet1" `
	-StartRow 2 `
	-ApiUrl "http://localhost:5025/PIQI/ScoreAuditMessage" `
	-DataProviderID "Session ID ABC123" `
	-DataSourceID "Session ID ABC123" `
	-AuditOutputDir "C:\data\piqi-audit-files" `
	-AccessDbPath "C:\data\piqi-audit.accdb" `
	-AccessTableName "PiqiAuditLog"
```

Dry-run mode (build payloads and audit records only, no API call):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\process-lab-data.ps1 `
	-InputPath "C:\data\lab-input.xlsx" `
	-Worksheet "Sheet1" `
	-DataProviderID "Session ID ABC123" `
	-DataSourceID "Session ID ABC123" `
	-AuditOutputDir "C:\data\piqi-audit-files" `
	-DryRun
```

### Run (dry-run mode)

Builds request payloads and writes records to Access without calling the API.

```bash
npm run process:lab -- \
	--excel "C:\\data\\lab-input.xlsx" \
	--access-db "C:\\data\\piqi-audit.accdb" \
	--data-provider-id "Session ID ABC123" \
	--data-source-id "Session ID ABC123" \
	--dry-run
```

### Import flat files into Access

- The CSV output is the easiest file to import into Access using External Data -> Text File.
- Map `requestBody` and `responseBody` to Long Text / Memo fields in Access.
- The JSONL file is preserved for full-fidelity machine-readable audit history.

### Access Tables

Two tables are automatically created in the Access database:

#### PiqiAuditLog (default `--table-name`)

Main audit log for each row submission:

- run id
- worksheet row number
- request/response timestamps
- duration milliseconds
- API URL
- message ID
- HTTP status
- success flag
- attempt count
- error type/message
- request body (JSON)
- response body (JSON/text)

#### PiqiAssessmentResults (default `--assessment-table-name`)

Detailed assessment results extracted from PIQI responses for each data class attribute evaluated.
Created automatically when audit logging is enabled with `--access-db`.

Fields:

- Message ID - links to PiqiAuditLog
- Data Class - USCDI data class (e.g., "Lab Results", "Medications", "Conditions")
- Attribute Name - specific attribute evaluated
- Attribute Value - actual data value from message
- Assessment - evaluation type applied
- Status - result status (e.g., "PASSED", "FAILED", "CONDITIONAL_PASS")
- Reason - explanation of assessment result
- Effect - impact/recommendation from assessment

### Notes

- Processing is sequential by design for easier audit/retry tracking.
- Start row defaults to 2, assuming row 1 is headers.
- The converter currently expects fixed lab columns aligned to the existing web utility mapping.
- `process:lab` auto-initializes the Access file/tables before processing rows.
- `process:lab` can run with Access only, flat files only, or both.
- If `odbc` is unavailable, use `--audit-output-dir` and import the CSV into Access later.
- Assessment results are automatically extracted from successful PIQI API responses and logged to `PiqiAssessmentResults` table for detailed audit trails.
- Use `--assessment-table-name` to customize the assessment results table name (default: `PiqiAssessmentResults`).
