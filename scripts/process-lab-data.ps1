param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$Worksheet = 'Sheet1',

    [int]$StartRow = 2,

    [Parameter(Mandatory = $true)]
    [string]$ApiUrl,

    [Parameter(Mandatory = $true)]
    [string]$DataProviderID,

    [Parameter(Mandatory = $true)]
    [string]$DataSourceID,

    [string]$PiqiModelMnemonic = 'PAT_CLINICAL_V1',

    [string]$EvaluationRubricMnemonic = 'USCDI_V3',

    [int]$MaxRetries = 1,

    [int]$RetryDelayMs = 1000,

    [string]$AuditOutputDir = '.\\audit-output',

    [string]$AccessDbPath,

    [string]$AccessTableName = 'PiqiAuditLog',

    [string]$AccessAssessmentTableName = 'PiqiAssessmentResults',

    [int]$AccessBatchSize = 100,

    [switch]$DryRun,

    [switch]$Benchmark,

    [string]$BenchmarkOutputPath
)

$ErrorActionPreference = 'Stop'

function Get-CellText {
    param($Value)

    if ($null -eq $Value) { return '' }
    return [string]$Value
}

function Normalize-TableName {
    param([string]$TableName)

    if ([string]::IsNullOrWhiteSpace($TableName)) {
        throw 'Table name is required.'
    }

    if ($TableName -notmatch '^[A-Za-z][A-Za-z0-9_]*$') {
        throw "Invalid table name '$TableName'. Use letters, numbers, and underscore only."
    }

    return $TableName
}

function Get-AceProvider {
    $providers = @(
        'Microsoft.ACE.OLEDB.16.0',
        'Microsoft.ACE.OLEDB.12.0'
    )

    foreach ($provider in $providers) {
        try {
            $null = New-Object System.Data.OleDb.OleDbConnection("Provider=$provider;Data Source=:memory:")
            return $provider
        }
        catch {
            continue
        }
    }

    return $null
}

function Open-AccessConnection {
    param([string]$DatabasePath)

    if (-not (Test-Path -LiteralPath $DatabasePath)) {
        throw "Access database not found: $DatabasePath"
    }

    $provider = Get-AceProvider
    if (-not $provider) {
        throw 'No compatible ACE OLEDB provider found. Install Microsoft Access Database Engine.'
    }

    $connection = New-Object System.Data.OleDb.OleDbConnection("Provider=$provider;Data Source=$DatabasePath;")
    $connection.Open()
    return $connection
}

function Ensure-AccessAuditTable {
    param(
        [System.Data.OleDb.OleDbConnection]$Connection,
        [string]$TableName
    )

    $safeTable = Normalize-TableName -TableName $TableName

    $schema = $Connection.GetOleDbSchemaTable(
        [System.Data.OleDb.OleDbSchemaGuid]::Tables,
        @($null, $null, $safeTable, 'TABLE')
    )

    if ($schema.Rows.Count -gt 0) {
        return
    }

    $command = $Connection.CreateCommand()
    $command.CommandText = @"
CREATE TABLE [$safeTable] (
    Id COUNTER PRIMARY KEY,
    RunId TEXT(64),
    RowNumber INTEGER,
    RequestTimestamp DATETIME,
    ResponseTimestamp DATETIME,
    DurationMs INTEGER,
    ApiUrl TEXT(255),
    MessageID TEXT(255),
    HttpStatus INTEGER,
    WasSuccess YESNO,
    AttemptCount INTEGER,
    ErrorType TEXT(64),
    ErrorMessage LONGTEXT,
    RequestBody LONGTEXT,
    ResponseBody LONGTEXT
)
"@
    $null = $command.ExecuteNonQuery()
}

function Insert-AccessAuditRecord {
    param(
        [System.Data.OleDb.OleDbConnection]$Connection,
        [string]$TableName,
        [pscustomobject]$Record,
        [System.Data.OleDb.OleDbTransaction]$Transaction = $null
    )

    function Convert-ToAccessDateText {
        param($Value)

        if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
            return $null
        }

        $parsed = if ($Value -is [datetime]) { $Value } else { [datetime]$Value }
        return $parsed.ToString('M/d/yyyy H:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)
    }

    $safeTable = Normalize-TableName -TableName $TableName
    $requestTimestampText = Convert-ToAccessDateText -Value $Record.RequestTimestamp
    $responseTimestampText = Convert-ToAccessDateText -Value $Record.ResponseTimestamp

    $command = $Connection.CreateCommand()
    if ($Transaction) {
        $command.Transaction = $Transaction
    }
    $command.CommandText = @"
INSERT INTO [$safeTable] (
    RunId, RowNumber, RequestTimestamp, ResponseTimestamp, DurationMs,
    ApiUrl, MessageID, HttpStatus, WasSuccess, AttemptCount,
    ErrorType, ErrorMessage, RequestBody, ResponseBody
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"@

    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p1', [string]$Record.RunId)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p2', [int]$Record.RowNumber)))
    if ($null -eq $requestTimestampText) {
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p3', [System.DBNull]::Value)))
    }
    else {
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p3', [string]$requestTimestampText)))
    }

    if ($null -eq $responseTimestampText) {
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p4', [System.DBNull]::Value)))
    }
    else {
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p4', [string]$responseTimestampText)))
    }
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p5', [int]$Record.DurationMs)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p6', [string]$Record.ApiUrl)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p7', [string]$Record.MessageID)))

    if ($null -eq $Record.HttpStatus) {
        $statusParam = New-Object System.Data.OleDb.OleDbParameter('@p8', [System.DBNull]::Value)
        $null = $command.Parameters.Add($statusParam)
    }
    else {
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p8', [int]$Record.HttpStatus)))
    }

    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p9', [bool]$Record.WasSuccess)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p10', [int]$Record.AttemptCount)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p11', [string]$Record.ErrorType)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p12', [string]$Record.ErrorMessage)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p13', [string]$Record.RequestBody)))
    $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p14', [string]$Record.ResponseBody)))

    $null = $command.ExecuteNonQuery()
}

function Ensure-AccessAssessmentTable {
    param(
        [System.Data.OleDb.OleDbConnection]$Connection,
        [string]$TableName
    )

    $safeTable = Normalize-TableName -TableName $TableName

    $schema = $Connection.GetOleDbSchemaTable(
        [System.Data.OleDb.OleDbSchemaGuid]::Tables,
        @($null, $null, $safeTable, 'TABLE')
    )

    if ($schema.Rows.Count -gt 0) {
        return
    }

    $command = $Connection.CreateCommand()
    $command.CommandText = @"
CREATE TABLE [$safeTable] (
    Id COUNTER PRIMARY KEY,
    MessageID TEXT(255),
    DataClass TEXT(255),
    AttributeName TEXT(255),
    AttributeValue LONGTEXT,
    Assessment TEXT(255),
    Status TEXT(50),
    Reason LONGTEXT,
    Effect LONGTEXT
)
"@
    $null = $command.ExecuteNonQuery()
}

function Insert-AccessAssessmentRecords {
    param(
        [System.Data.OleDb.OleDbConnection]$Connection,
        [string]$TableName,
        [object[]]$Records,
        [System.Data.OleDb.OleDbTransaction]$Transaction = $null
    )

    if ($null -eq $Records -or $Records.Count -eq 0) {
        return
    }

    $safeTable = Normalize-TableName -TableName $TableName

    foreach ($record in $Records) {
        $command = $Connection.CreateCommand()
        if ($Transaction) {
            $command.Transaction = $Transaction
        }
        $command.CommandText = @"
INSERT INTO [$safeTable] (
    MessageID, DataClass, AttributeName, AttributeValue,
    Assessment, Status, Reason, Effect
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
"@

        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p1', [string]$record.MessageID)))
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p2', [string]$record.DataClass)))
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p3', [string]$record.AttributeName)))
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p4', [string]$record.AttributeValue)))
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p5', [string]$record.Assessment)))
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p6', [string]$record.Status)))
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p7', [string]$record.Reason)))
        $null = $command.Parameters.Add((New-Object System.Data.OleDb.OleDbParameter('@p8', [string]$record.Effect)))

        $null = $command.ExecuteNonQuery()
    }
}

function Format-AssessmentValue {
    param([object]$Value)

    if ($null -eq $Value) {
        return 'N/A'
    }

    $text = if ($Value -is [string]) {
        $Value
    }
    elseif ($Value.GetType().IsPrimitive) {
        [string]$Value
    }
    else {
        ConvertTo-Json -InputObject $Value -Depth 10 -Compress
    }

    if ($text.Length -gt 1000) {
        return $text.Substring(0, 1000) + '...'
    }

    return $text
}

function Extract-AssessmentItems {
    param(
        [string]$MessageID,
        [string]$ResponseBody
    )

    if ([string]::IsNullOrWhiteSpace($ResponseBody)) {
        return @()
    }

    $parsedResponse = $null
    try {
        # Use -Depth only if available (PowerShell 7+), otherwise fall back to default
        if ($PSVersionTable.PSVersion.Major -ge 7) {
            $parsedResponse = ConvertFrom-Json -InputObject $ResponseBody -Depth 100
        }
        else {
            $parsedResponse = ConvertFrom-Json -InputObject $ResponseBody
        }
    }
    catch {
        return @()
    }

    $auditedMessage = if ($parsedResponse.PSObject.Properties['auditedMessage']) {
        $parsedResponse.auditedMessage
    }
    elseif ($parsedResponse.PSObject.Properties['messageData']) {
        $parsedResponse.messageData
    }
    else {
        $null
    }

    if ($null -eq $auditedMessage) {
        return @()
    }

    $parsedMessage = $null
    try {
        $parsedMessage = if ($auditedMessage -is [string]) {
            if ($PSVersionTable.PSVersion.Major -ge 7) {
                ConvertFrom-Json -InputObject $auditedMessage -Depth 100
            }
            else {
                ConvertFrom-Json -InputObject $auditedMessage
            }
        }
        else {
            $auditedMessage
        }
    }
    catch {
        return @()
    }

    if ($null -eq $parsedMessage) {
        return @()
    }

    $resolvedMessage = $parsedMessage
    if ($null -eq $resolvedMessage.patient) {
        $innerPayload = $null
        if ($resolvedMessage.PSObject.Properties['messageData']) {
            $innerPayload = $resolvedMessage.messageData
        }
        elseif ($resolvedMessage.PSObject.Properties['auditedMessage']) {
            $innerPayload = $resolvedMessage.auditedMessage
        }

        if ($null -ne $innerPayload) {
            try {
                $resolvedMessage = if ($innerPayload -is [string]) {
                    ConvertFrom-Json -InputObject $innerPayload -Depth 100
                }
                else {
                    $innerPayload
                }
            }
            catch {
                $resolvedMessage = $null
            }
        }
    }

    if ($null -eq $resolvedMessage -or $null -eq $resolvedMessage.patient) {
        return @()
    }

    $dataClassPaths = [ordered]@{
        'Lab Results' = 'labResults'
        'Medications' = 'medications'
        'Allergies' = 'allergies'
        'Conditions' = 'conditions'
        'Procedures' = 'procedures'
        'Vital Signs' = 'vitalSigns'
        'Immunizations' = 'immunizations'
        'Demographics' = 'demographics'
        'Encounters' = 'encounters'
        'Providers' = 'providers'
        'Clinical Documents' = 'clinicalDocuments'
        'Diagnostic Imaging' = 'diagnosticImaging'
        'Goals' = 'goals'
        'Health Assessments' = 'healthAssessments'
        'Medical Devices' = 'medicalDevices'
    }

    $assessmentRecords = New-Object 'System.Collections.Generic.List[object]'

    foreach ($entry in $dataClassPaths.GetEnumerator()) {
        $dataClassName = $entry.Key
        $dataPath = $entry.Value
        $dataArray = $resolvedMessage.patient.$dataPath

        if ($null -eq $dataArray) {
            continue
        }

        foreach ($element in @($dataArray)) {
            if ($null -eq $element) {
                continue
            }

            foreach ($property in $element.PSObject.Properties) {
                $attribute = $property.Value
                if ($null -eq $attribute) {
                    continue
                }

                $attributeAudit = $attribute.attributeAudit
                if ($null -eq $attributeAudit -or $null -eq $attributeAudit.assessmentItems) {
                    continue
                }

                $attributeValue = Format-AssessmentValue -Value $attribute.data

                foreach ($item in @($attributeAudit.assessmentItems)) {
                    if ($null -eq $item) {
                        continue
                    }

                    [void]$assessmentRecords.Add([pscustomobject]@{
                        MessageID = $MessageID
                        DataClass = $dataClassName
                        AttributeName = if ($item.attributeName) { [string]$item.attributeName } else { [string]$property.Name }
                        AttributeValue = $attributeValue
                        Assessment = if ($item.assessment) { [string]$item.assessment } else { '' }
                        Status = if ($item.status) { [string]$item.status } else { '' }
                        Reason = if ($item.reason) { [string]$item.reason } else { '' }
                        Effect = if ($item.effect) { [string]$item.effect } else { '' }
                    })
                }
            }
        }
    }

    return $assessmentRecords.ToArray()
}

function Flush-AccessBatch {
    param(
        [System.Data.OleDb.OleDbConnection]$Connection,
        [string]$AuditTableName,
        [string]$AssessmentTableName,
        [System.Collections.Generic.List[object]]$AuditRecords,
        [System.Collections.Generic.List[object]]$AssessmentRecords
    )

    if (($null -eq $AuditRecords -or $AuditRecords.Count -eq 0) -and ($null -eq $AssessmentRecords -or $AssessmentRecords.Count -eq 0)) {
        return
    }

    $transaction = $Connection.BeginTransaction()
    try {
        foreach ($auditRecord in $AuditRecords) {
            Insert-AccessAuditRecord -Connection $Connection -TableName $AuditTableName -Record $auditRecord -Transaction $transaction
        }

        if ($AssessmentRecords -and $AssessmentRecords.Count -gt 0) {
            Insert-AccessAssessmentRecords -Connection $Connection -TableName $AssessmentTableName -Records $AssessmentRecords.ToArray() -Transaction $transaction
        }

        $transaction.Commit()
        $AuditRecords.Clear()
        $AssessmentRecords.Clear()
    }
    catch {
        try {
            $transaction.Rollback()
        }
        catch {
        }
        throw
    }
    finally {
        $transaction.Dispose()
    }
}

function Read-ExcelRows {
    param(
        [string]$Path,
        [string]$SheetName,
        [int]$DataStartRow
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Input file not found: $Path"
    }

    $excel = $null
    $workbook = $null
    $worksheet = $null

    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false

        $workbook = $excel.Workbooks.Open((Resolve-Path $Path).Path)
        $worksheet = $workbook.Worksheets.Item($SheetName)

        if (-not $worksheet) {
            throw "Worksheet not found: $SheetName"
        }

        $usedRange = $worksheet.UsedRange
        $rowCount = [int]$usedRange.Rows.Count
        $colCount = [int]$usedRange.Columns.Count

        $rows = New-Object 'System.Collections.Generic.List[object]'
        $targetColCount = [Math]::Max($colCount, 22)
        for ($row = $DataStartRow; $row -le $rowCount; $row++) {
            $rowValues = New-Object 'System.Collections.Generic.List[string]'
            $isAllBlank = $true

            for ($col = 1; $col -le $targetColCount; $col++) {
                $cellValue = $worksheet.Cells.Item($row, $col).Text
                $textValue = Get-CellText -Value $cellValue
                if (-not [string]::IsNullOrWhiteSpace($textValue)) {
                    $isAllBlank = $false
                }
                [void]$rowValues.Add($textValue)
            }

            if (-not $isAllBlank) {
                [void]$rows.Add(@($row, $rowValues.ToArray()))
            }
        }

        return $rows.ToArray()
    }
    finally {
        if ($workbook) { $workbook.Close($false) }
        if ($excel) { $excel.Quit() }

        if ($worksheet) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet) }
        if ($workbook) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
        if ($excel) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }

        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Convert-RowToMessageData {
    param(
        [string[]]$Values,
        [string]$ProviderId,
        [string]$SourceId
    )

    $uniqueId = if ($Values.Count -ge 1) { $Values[0] } else { '' }
    $testName = if ($Values.Count -ge 4) { $Values[3] } else { '' }
    $resultText = if ($Values.Count -ge 7) { $Values[6] } else { '' }
    $loincCode = if ($Values.Count -ge 18) { $Values[17] } else { '' }
    $units = if ($Values.Count -ge 19) { $Values[18] } else { '' }
    $abnormal = if ($Values.Count -ge 20) { $Values[19] } else { '' }
    $refHigh = if ($Values.Count -ge 21) { $Values[20] } else { '' }
    $refLow = if ($Values.Count -ge 22) { $Values[21] } else { '' }

    $testCodings = @()
    if (-not [string]::IsNullOrWhiteSpace($loincCode)) {
        $testCodings += @{
            code = $loincCode
            display = $testName
            system = '2.16.840.1.113883.6.1'
        }
    }

    $unitCodings = @()
    if (-not [string]::IsNullOrWhiteSpace($units)) {
        $unitCodings += @{
            code = $units
            display = $units
            system = 'UCUM'
        }
    }

    $referenceRange = @{}
    if (-not [string]::IsNullOrWhiteSpace($refLow)) {
        $referenceRange.lowValue = $refLow
    }
    if (-not [string]::IsNullOrWhiteSpace($refHigh)) {
        $referenceRange.highValue = $refHigh
    }

    $interpretCode = if (-not [string]::IsNullOrWhiteSpace($abnormal)) { $abnormal } else { 'N' }

    return @{
        messageID = $uniqueId
        formatID = ''
        useCaseID = ''
        patient = @{
            labResults = @(
                @{
                    test = @{
                        codings = $testCodings
                        text = $testName
                    }
                    referenceRange = $referenceRange
                    resultValue = @{
                        text = $resultText
                        type = @{ text = 'PQ' }
                    }
                    resultUnit = @{
                        codings = $unitCodings
                        text = $units
                    }
                    interpretation = @{
                        codings = @(
                            @{
                                code = $interpretCode
                                system = '2.16.840.1.113883.5.83'
                            }
                        )
                        text = $interpretCode
                    }
                }
            )
            id = $uniqueId
        }
        dataSourceID = $SourceId
        dataProviderID = $ProviderId
    }
}

function Build-RequestBody {
    param(
        [hashtable]$MessageData,
        [string]$ProviderId,
        [string]$SourceId,
        [string]$ModelMnemonic,
        [string]$RubricMnemonic
    )

    $messageId = $MessageData.messageID

    return @{
        dataProviderID = $ProviderId
        dataSourceID = $SourceId
        messageID = $messageId
        piqiModelMnemonic = $ModelMnemonic
        evaluationRubricMnemonic = $RubricMnemonic
        messageData = ($MessageData | ConvertTo-Json -Depth 15 -Compress)
    }
}

function Invoke-ApiWithRetry {
    param(
        [string]$Endpoint,
        [hashtable]$Body,
        [string]$JsonPayload,
        [int]$Retries,
        [int]$DelayMs,
        [switch]$NoSubmit
    )

    $attempt = 0

    while ($attempt -le $Retries) {
        $attempt++
        $requestTime = Get-Date

        if ($NoSubmit) {
            return [pscustomobject]@{
                RequestTimestamp = $requestTime
                ResponseTimestamp = Get-Date
                AttemptCount = $attempt
                HttpStatus = $null
                WasSuccess = $true
                ErrorType = $null
                ErrorMessage = $null
                ResponseBody = 'DRY_RUN'
            }
        }

        try {
            if ([string]::IsNullOrWhiteSpace($JsonPayload)) {
                $JsonPayload = $Body | ConvertTo-Json -Depth 20 -Compress
            }
            $response = Invoke-WebRequest -Uri $Endpoint -Method Post -ContentType 'application/json' -Body $jsonPayload
            $responseText = Get-CellText -Value $response.Content

            return [pscustomobject]@{
                RequestTimestamp = $requestTime
                ResponseTimestamp = Get-Date
                AttemptCount = $attempt
                HttpStatus = [int]$response.StatusCode
                WasSuccess = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
                ErrorType = $null
                ErrorMessage = $null
                ResponseBody = $responseText
            }
        }
        catch {
            $responseTime = Get-Date
            $statusCode = $null
            $errorBody = $null

            if ($_.Exception.Response) {
                try {
                    $statusCode = [int]$_.Exception.Response.StatusCode.value__
                    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $errorBody = $reader.ReadToEnd()
                    $reader.Dispose()
                }
                catch {
                    $errorBody = $null
                }
            }

            if ($attempt -gt $Retries) {
                return [pscustomobject]@{
                    RequestTimestamp = $requestTime
                    ResponseTimestamp = $responseTime
                    AttemptCount = $attempt
                    HttpStatus = $statusCode
                    WasSuccess = $false
                    ErrorType = if ($statusCode) { 'http_error' } else { 'network_error' }
                    ErrorMessage = $_.Exception.Message
                    ResponseBody = $errorBody
                }
            }

            Start-Sleep -Milliseconds $DelayMs
        }
    }
}

function Initialize-AuditFiles {
    param(
        [string]$OutputDirectory,
        [string]$RunId
    )

    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
    if (-not (Test-Path -LiteralPath $resolvedOutput)) {
        New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
    }

    $jsonlPath = Join-Path $resolvedOutput "piqi-audit-$RunId.jsonl"
    $csvPath = Join-Path $resolvedOutput "piqi-audit-$RunId.csv"

    $csvHeader = @(
        'RunId',
        'RowNumber',
        'RequestTimestamp',
        'ResponseTimestamp',
        'DurationMs',
        'ApiUrl',
        'MessageID',
        'HttpStatus',
        'WasSuccess',
        'AttemptCount',
        'ErrorType',
        'ErrorMessage',
        'RequestBody',
        'ResponseBody'
    ) -join ','

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $jsonlWriter = New-Object System.IO.StreamWriter($jsonlPath, $false, $utf8NoBom)
    $csvWriter = New-Object System.IO.StreamWriter($csvPath, $false, $utf8NoBom)
    $csvWriter.WriteLine($csvHeader)

    return [pscustomobject]@{
        JsonlPath = $jsonlPath
        CsvPath = $csvPath
        JsonlWriter = $jsonlWriter
        CsvWriter = $csvWriter
    }
}

function Append-AuditFiles {
    param(
        [pscustomobject]$AuditFiles,
        [pscustomobject]$Record
    )

    $AuditFiles.JsonlWriter.WriteLine(($Record | ConvertTo-Json -Depth 10 -Compress))

    $csvRow = $Record | Select-Object `
        RunId, RowNumber, RequestTimestamp, ResponseTimestamp, DurationMs, ApiUrl, MessageID,
        HttpStatus, WasSuccess, AttemptCount, ErrorType, ErrorMessage, RequestBody, ResponseBody

    $csvLine = ($csvRow | ConvertTo-Csv -NoTypeInformation)[1]
    $AuditFiles.CsvWriter.WriteLine($csvLine)
}

function Close-AuditFiles {
    param(
        [pscustomobject]$AuditFiles
    )

    if ($AuditFiles.JsonlWriter) {
        $AuditFiles.JsonlWriter.Flush()
        $AuditFiles.JsonlWriter.Dispose()
    }

    if ($AuditFiles.CsvWriter) {
        $AuditFiles.CsvWriter.Flush()
        $AuditFiles.CsvWriter.Dispose()
    }
}

if ($StartRow -lt 1) {
    throw 'StartRow must be >= 1.'
}

if ($MaxRetries -lt 0) {
    throw 'MaxRetries must be >= 0.'
}

if ($RetryDelayMs -lt 0) {
    throw 'RetryDelayMs must be >= 0.'
}

if ($AccessBatchSize -lt 1) {
    throw 'AccessBatchSize must be >= 1.'
}

$runId = [Guid]::NewGuid().ToString('N')
$runStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$metrics = [ordered]@{
    excelReadMs = 0
    accessInitMs = 0
    messageBuildMs = 0
    requestSerializeMs = 0
    apiSubmitMs = 0
    auditWriteMs = 0
    accessWriteMs = 0
}

$auditFiles = Initialize-AuditFiles -OutputDirectory $AuditOutputDir -RunId $runId
$excelReadStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$excelRows = Read-ExcelRows -Path $InputPath -SheetName $Worksheet -DataStartRow $StartRow
$excelReadStopwatch.Stop()
$metrics.excelReadMs = [int]$excelReadStopwatch.ElapsedMilliseconds

$accessConnection = $null
if (-not [string]::IsNullOrWhiteSpace($AccessDbPath)) {
    $accessInitStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $accessConnection = Open-AccessConnection -DatabasePath $AccessDbPath
    Ensure-AccessAuditTable -Connection $accessConnection -TableName $AccessTableName
    Ensure-AccessAssessmentTable -Connection $accessConnection -TableName $AccessAssessmentTableName
    $accessInitStopwatch.Stop()
    $metrics.accessInitMs = [int]$accessInitStopwatch.ElapsedMilliseconds
}

$accessWritesEnabled = $null -ne $accessConnection
if ($accessWritesEnabled) {
    Write-Host "Startup: Access writes enabled. DB=$AccessDbPath Table=$AccessTableName BatchSize=$AccessBatchSize"
}
else {
    Write-Host 'Startup: Access writes disabled. Use -AccessDbPath to enable Access persistence.'
}

$processed = 0
$succeeded = 0
$failed = 0
$assessmentInserted = 0
$batchedAuditRecords = New-Object 'System.Collections.Generic.List[object]'
$batchedAssessmentRecords = New-Object 'System.Collections.Generic.List[object]'

try {
    foreach ($entry in $excelRows) {
        $rowNumber = [int]$entry[0]
        [string[]]$rowValues = $entry[1]

        $messageBuildStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $messageData = Convert-RowToMessageData -Values $rowValues -ProviderId $DataProviderID -SourceId $DataSourceID
        $requestBody = Build-RequestBody -MessageData $messageData -ProviderId $DataProviderID -SourceId $DataSourceID -ModelMnemonic $PiqiModelMnemonic -RubricMnemonic $EvaluationRubricMnemonic
        $messageBuildStopwatch.Stop()
        $metrics.messageBuildMs += [int]$messageBuildStopwatch.ElapsedMilliseconds

        $requestSerializeStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $requestBodyJson = $requestBody | ConvertTo-Json -Depth 20 -Compress
        $requestSerializeStopwatch.Stop()
        $metrics.requestSerializeMs += [int]$requestSerializeStopwatch.ElapsedMilliseconds

        $apiSubmitStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $apiResult = Invoke-ApiWithRetry -Endpoint $ApiUrl -Body $requestBody -JsonPayload $requestBodyJson -Retries $MaxRetries -DelayMs $RetryDelayMs -NoSubmit:$DryRun
        $apiSubmitStopwatch.Stop()
        $metrics.apiSubmitMs += [int]$apiSubmitStopwatch.ElapsedMilliseconds

        $durationMs = [int]([datetime]$apiResult.ResponseTimestamp - [datetime]$apiResult.RequestTimestamp).TotalMilliseconds

        $auditRecord = [pscustomobject]@{
            RunId = $runId
            RowNumber = $rowNumber
            RequestTimestamp = ([datetime]$apiResult.RequestTimestamp).ToString('o')
            ResponseTimestamp = ([datetime]$apiResult.ResponseTimestamp).ToString('o')
            DurationMs = $durationMs
            ApiUrl = if ($DryRun) { 'DRY_RUN' } else { $ApiUrl }
            MessageID = $requestBody.messageID
            HttpStatus = $apiResult.HttpStatus
            WasSuccess = [bool]$apiResult.WasSuccess
            AttemptCount = [int]$apiResult.AttemptCount
            ErrorType = $apiResult.ErrorType
            ErrorMessage = $apiResult.ErrorMessage
            RequestBody = $requestBodyJson
            ResponseBody = Get-CellText -Value $apiResult.ResponseBody
        }

        $auditWriteStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        Append-AuditFiles -AuditFiles $auditFiles -Record $auditRecord
        $auditWriteStopwatch.Stop()
        $metrics.auditWriteMs += [int]$auditWriteStopwatch.ElapsedMilliseconds

        if ($accessConnection) {
            [void]$batchedAuditRecords.Add($auditRecord)

            if ($apiResult.WasSuccess -and -not $DryRun) {
                $assessmentRecords = Extract-AssessmentItems -MessageID $requestBody.messageID -ResponseBody $apiResult.ResponseBody
                if ($assessmentRecords.Count -gt 0) {
                    foreach ($assessmentRecord in $assessmentRecords) {
                        [void]$batchedAssessmentRecords.Add($assessmentRecord)
                    }
                    $assessmentInserted += $assessmentRecords.Count
                }
            }

            if ($batchedAuditRecords.Count -ge $AccessBatchSize) {
                $accessWriteStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
                Flush-AccessBatch -Connection $accessConnection -AuditTableName $AccessTableName -AssessmentTableName $AccessAssessmentTableName -AuditRecords $batchedAuditRecords -AssessmentRecords $batchedAssessmentRecords
                $accessWriteStopwatch.Stop()
                $metrics.accessWriteMs += [int]$accessWriteStopwatch.ElapsedMilliseconds
            }
        }

        $processed++
        if ($apiResult.WasSuccess) {
            $succeeded++
            Write-Host "[Row $rowNumber] SUCCESS status=$($apiResult.HttpStatus) attempts=$($apiResult.AttemptCount)"
        }
        else {
            $failed++
            Write-Host "[Row $rowNumber] FAILED status=$($apiResult.HttpStatus) attempts=$($apiResult.AttemptCount)"
        }
    }
}
finally {
    $runStopwatch.Stop()

    if ($accessConnection -and $accessConnection.State -eq [System.Data.ConnectionState]::Open -and ($batchedAuditRecords.Count -gt 0 -or $batchedAssessmentRecords.Count -gt 0)) {
        $accessWriteStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        Flush-AccessBatch -Connection $accessConnection -AuditTableName $AccessTableName -AssessmentTableName $AccessAssessmentTableName -AuditRecords $batchedAuditRecords -AssessmentRecords $batchedAssessmentRecords
        $accessWriteStopwatch.Stop()
        $metrics.accessWriteMs += [int]$accessWriteStopwatch.ElapsedMilliseconds
    }

    Close-AuditFiles -AuditFiles $auditFiles

    if ($accessConnection -and $accessConnection.State -eq [System.Data.ConnectionState]::Open) {
        $accessConnection.Close()
    }
    if ($accessConnection) {
        $accessConnection.Dispose()
    }
}

Write-Host 'Run complete.'
Write-Host "Run ID: $runId"
Write-Host "Processed: $processed"
Write-Host "Succeeded: $succeeded"
Write-Host "Failed: $failed"
Write-Host "Audit JSONL: $($auditFiles.JsonlPath)"
Write-Host "Audit CSV: $($auditFiles.CsvPath)"
if ($accessConnection -or -not [string]::IsNullOrWhiteSpace($AccessDbPath)) {
    Write-Host "Access DB: $AccessDbPath"
    Write-Host "Assessment Rows Inserted: $assessmentInserted"
}

if ($Benchmark) {
    $totalMs = [int]$runStopwatch.ElapsedMilliseconds
    $rowsPerSecond = if ($totalMs -gt 0) { [math]::Round(($processed * 1000.0) / $totalMs, 2) } else { 0 }
    $avgRowMs = if ($processed -gt 0) { [math]::Round($metrics.apiSubmitMs / $processed, 2) } else { 0 }

    $summary = [ordered]@{
        runId = $runId
        processed = $processed
        succeeded = $succeeded
        failed = $failed
        totalRunMs = $totalMs
        rowsPerSecond = $rowsPerSecond
        avgApiSubmitMsPerRow = $avgRowMs
        stageMs = $metrics
    }

    Write-Host 'Benchmark summary:'
    Write-Host (ConvertTo-Json -InputObject $summary -Depth 6 -Compress)

    if (-not [string]::IsNullOrWhiteSpace($BenchmarkOutputPath)) {
        $resolvedBenchmarkPath = [System.IO.Path]::GetFullPath($BenchmarkOutputPath)
        $benchmarkDirectory = [System.IO.Path]::GetDirectoryName($resolvedBenchmarkPath)
        if (-not [string]::IsNullOrWhiteSpace($benchmarkDirectory) -and -not (Test-Path -LiteralPath $benchmarkDirectory)) {
            New-Item -ItemType Directory -Path $benchmarkDirectory -Force | Out-Null
        }

        ConvertTo-Json -InputObject $summary -Depth 6 | Set-Content -Path $resolvedBenchmarkPath -Encoding UTF8
        Write-Host "Benchmark JSON: $resolvedBenchmarkPath"
    }
}
