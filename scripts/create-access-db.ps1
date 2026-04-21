param(
    [Parameter(Mandatory = $true)]
    [string]$AccessDbPath,

    [string]$TableName,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Test-ValidTableName {
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        throw 'Table name cannot be empty.'
    }

    if ($Name -notmatch '^[A-Za-z][A-Za-z0-9_]*$') {
        throw "Invalid table name '$Name'. Use letters, numbers, and underscore only."
    }
}

function Get-ExistingAdoProvider {
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

function Create-AccessDatabase {
    param(
        [string]$DatabasePath,
        [switch]$Overwrite
    )

    $resolvedPath = [System.IO.Path]::GetFullPath($DatabasePath)
    $directoryPath = [System.IO.Path]::GetDirectoryName($resolvedPath)

    if (-not [string]::IsNullOrWhiteSpace($directoryPath) -and -not (Test-Path -LiteralPath $directoryPath)) {
        New-Item -ItemType Directory -Path $directoryPath -Force | Out-Null
    }

    if ((Test-Path -LiteralPath $resolvedPath) -and -not $Overwrite) {
        Write-Host "Database already exists: $resolvedPath"
        return $resolvedPath
    }

    if ((Test-Path -LiteralPath $resolvedPath) -and $Overwrite) {
        Remove-Item -LiteralPath $resolvedPath -Force
    }

    $provider = Get-ExistingAdoProvider
    if (-not $provider) {
        throw 'No compatible ACE OLEDB provider found. Install Microsoft Access Database Engine.'
    }

    $catalog = New-Object -ComObject ADOX.Catalog
    $connectionString = "Provider=$provider;Data Source=$resolvedPath;Jet OLEDB:Engine Type=5;"
    $catalog.Create($connectionString)

    return $resolvedPath
}

function Ensure-AuditTable {
    param(
        [string]$DatabasePath,
        [string]$Provider,
        [string]$AuditTableName
    )

    Test-ValidTableName -Name $AuditTableName

    $connectionString = "Provider=$Provider;Data Source=$DatabasePath;"
    $connection = New-Object System.Data.OleDb.OleDbConnection($connectionString)

    try {
        $connection.Open()

        $schema = $connection.GetOleDbSchemaTable(
            [System.Data.OleDb.OleDbSchemaGuid]::Tables,
            @($null, $null, $AuditTableName, 'TABLE')
        )

        if ($schema.Rows.Count -gt 0) {
            Write-Host "Table already exists: $AuditTableName"
            return
        }

        $command = $connection.CreateCommand()
        $command.CommandText = @"
CREATE TABLE [$AuditTableName] (
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
        Write-Host "Created table: $AuditTableName"
    }
    finally {
        if ($connection.State -eq [System.Data.ConnectionState]::Open) {
            $connection.Close()
        }
        $connection.Dispose()
    }
}

$databasePath = Create-AccessDatabase -DatabasePath $AccessDbPath -Overwrite:$Force
Write-Host "Database ready: $databasePath"

if ($TableName) {
    $provider = Get-ExistingAdoProvider
    if (-not $provider) {
        throw 'No compatible ACE OLEDB provider found. Install Microsoft Access Database Engine.'
    }

    Ensure-AuditTable -DatabasePath $databasePath -Provider $provider -AuditTableName $TableName
}
