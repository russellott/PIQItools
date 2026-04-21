param(
    [string]$BenchmarkDir = '.\benchmarks',
    [switch]$ShowUnchanged
)

$ErrorActionPreference = 'Stop'

function Get-LatestBenchmarks {
    param([string]$Dir)

    if (-not (Test-Path -LiteralPath $Dir)) {
        throw "Benchmark directory not found: $Dir"
    }

    $benchmarkFiles = @(Get-ChildItem -LiteralPath $Dir -Filter '*.json' -File | 
        Sort-Object -Property LastWriteTime -Descending)

    if ($benchmarkFiles.Count -lt 2) {
        throw "Found only $($benchmarkFiles.Count) benchmark JSON file(s), need at least 2"
    }

    return @($benchmarkFiles[0], $benchmarkFiles[1])
}

try {
    $resolved = [System.IO.Path]::GetFullPath($BenchmarkDir)
    Write-Host "Searching for benchmarks in: $resolved"

    $latest = Get-LatestBenchmarks -Dir $resolved
    $newest = $latest[0]
    $previous = $latest[1]

    Write-Host "Newest:   $($newest.FullName)  ($($newest.LastWriteTime))"
    Write-Host "Previous: $($previous.FullName)  ($($previous.LastWriteTime))"
    Write-Host ''

    $args = @($previous.FullName, $newest.FullName)
    if ($ShowUnchanged) {
        $args += '--show-unchanged'
    }

    npm run benchmark:compare -- @args
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
