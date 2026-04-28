# Check and Create PostgreSQL Database and Tables for PIQI Tools
# This script verifies the PostgreSQL database and schema exist, creating them if not.

param(
    [string]$Host = $env:PGHOST,
    [int]$Port = 0,
    [string]$Database = $env:PGDATABASE,
    [string]$User = $env:PGUSER,
    [string]$Password = $env:PGPASSWORD
)

# Set defaults if not provided
if (-not $Host) { $Host = "localhost" }
if ($Port -eq 0) { 
    if ($env:PGPORT) { $Port = [int]$env:PGPORT } else { $Port = 5432 }
}
if (-not $Database) { $Database = "piqi" }
if (-not $User) { $User = "postgres" }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$schemaFile = Join-Path $projectRoot "src\db\schema.sql"

Write-Host "PostgreSQL Database Check and Setup" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Connection Details:"
Write-Host "  Host:     $Host`:$Port"
Write-Host "  Database: $Database"
Write-Host "  User:     $User"
Write-Host ""

# Check if psql is available
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlPath) {
    Write-Host "[X] psql command not found. Please ensure PostgreSQL client tools are installed and in PATH." -ForegroundColor Red
    exit 1
}

# Build connection string for psql
$env:PGPASSWORD = $Password

function Invoke-Psql {
    param(
        [string]$Query,
        [string]$DbName = $Database
    )
    $result = & psql -h $Host -p $Port -U $User -d $DbName -t -A -c $Query 2>&1
    return $result
}

function Test-DatabaseExists {
    param([string]$DbName)
    $query = "SELECT 1 FROM pg_database WHERE datname = '$DbName';"
    $result = & psql -h $Host -p $Port -U $User -d "postgres" -t -A -c $query 2>&1
    return $result -eq "1"
}

function Test-TableExists {
    param([string]$TableName)
    $query = "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$TableName';"
    $result = Invoke-Psql -Query $query
    return $result -eq "1"
}

# Step 1: Test basic PostgreSQL connectivity
Write-Host "Step 1: Testing PostgreSQL connectivity..." -ForegroundColor Yellow
try {
    $testResult = & psql -h $Host -p $Port -U $User -d "postgres" -t -A -c "SELECT 1;" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Cannot connect to PostgreSQL server." -ForegroundColor Red
        Write-Host "    Error: $testResult" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please ensure:" -ForegroundColor Yellow
        Write-Host "  - PostgreSQL server is running"
        Write-Host "  - Connection details are correct"
        Write-Host "  - Password is set via -Password parameter or PGPASSWORD environment variable"
        exit 1
    }
    Write-Host "[OK] Connected to PostgreSQL server" -ForegroundColor Green
} catch {
    Write-Host "[X] Failed to connect: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Check if database exists
Write-Host ""
Write-Host "Step 2: Checking if database '$Database' exists..." -ForegroundColor Yellow
$dbExists = Test-DatabaseExists -DbName $Database

if ($dbExists) {
    Write-Host "[OK] Database '$Database' exists" -ForegroundColor Green
} else {
    Write-Host "[!] Database '$Database' does not exist. Creating..." -ForegroundColor Yellow
    $createDbResult = & psql -h $Host -p $Port -U $User -d "postgres" -c "CREATE DATABASE $Database;" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Failed to create database: $createDbResult" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Database '$Database' created successfully" -ForegroundColor Green
}

# Step 3: Check and create tables
Write-Host ""
Write-Host "Step 3: Checking table schemas..." -ForegroundColor Yellow

$requiredTables = @("piqi_audit_log", "piqi_assessment_results")
$missingTables = @()

foreach ($table in $requiredTables) {
    $tableExists = Test-TableExists -TableName $table
    if ($tableExists) {
        Write-Host "  [OK] Table '$table' exists" -ForegroundColor Green
    } else {
        Write-Host "  [!] Table '$table' is missing" -ForegroundColor Yellow
        $missingTables += $table
    }
}

# Step 4: Create missing tables using schema.sql
if ($missingTables.Count -gt 0) {
    Write-Host ""
    Write-Host "Step 4: Creating missing tables from schema.sql..." -ForegroundColor Yellow
    
    if (-not (Test-Path $schemaFile)) {
        Write-Host "[X] Schema file not found: $schemaFile" -ForegroundColor Red
        exit 1
    }
    
    $schemaResult = & psql -h $Host -p $Port -U $User -d $Database -f $schemaFile 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Failed to execute schema: $schemaResult" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Schema applied successfully" -ForegroundColor Green
    
    # Verify tables were created
    Write-Host ""
    Write-Host "Verifying table creation..." -ForegroundColor Yellow
    foreach ($table in $missingTables) {
        $tableExists = Test-TableExists -TableName $table
        if ($tableExists) {
            Write-Host "  [OK] Table '$table' created" -ForegroundColor Green
        } else {
            Write-Host "  [X] Table '$table' was not created" -ForegroundColor Red
        }
    }
} else {
    Write-Host ""
    Write-Host "Step 4: All tables present, no schema changes needed" -ForegroundColor Green
}

# Step 5: Verify indexes
Write-Host ""
Write-Host "Step 5: Checking indexes..." -ForegroundColor Yellow
$indexQuery = @"
SELECT indexname FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE 'idx_%'
ORDER BY indexname;
"@
$indexes = Invoke-Psql -Query $indexQuery
if ($indexes) {
    $indexList = $indexes -split "`n" | Where-Object { $_ -ne "" }
    foreach ($idx in $indexList) {
        Write-Host "  [OK] Index '$idx' exists" -ForegroundColor Green
    }
} else {
    Write-Host "  [!] No custom indexes found (they will be created with schema)" -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "PostgreSQL Setup Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Database: $Database"
Write-Host "Tables:   $($requiredTables -join ', ')"
Write-Host ""
