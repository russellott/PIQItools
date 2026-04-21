#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function printUsage() {
    console.log('Usage: node compare-benchmarks.js <baseline.json> <candidate.json> [--baseline-label <name>] [--candidate-label <name>] [--show-unchanged]');
    console.log('Example: npm run benchmark:compare -- .\\benchmarks\\run-before.json .\\benchmarks\\run-after.json');
}

function parseArgs(argv) {
    const options = {
        baselinePath: null,
        candidatePath: null,
        baselineLabel: 'Baseline',
        candidateLabel: 'Candidate',
        showUnchanged: false
    };

    const positional = [];

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '--show-unchanged') {
            options.showUnchanged = true;
            continue;
        }

        if (arg === '--baseline-label') {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for --baseline-label');
            }
            options.baselineLabel = value;
            i += 1;
            continue;
        }

        if (arg === '--candidate-label') {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) {
                throw new Error('Missing value for --candidate-label');
            }
            options.candidateLabel = value;
            i += 1;
            continue;
        }

        positional.push(arg);
    }

    if (positional.length >= 1) options.baselinePath = positional[0];
    if (positional.length >= 2) options.candidatePath = positional[1];

    if (!options.baselinePath || !options.candidatePath) {
        throw new Error('Both baseline and candidate benchmark files are required.');
    }

    return options;
}

function readJson(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${resolved}`);
    }

    try {
        const raw = fs.readFileSync(resolved, 'utf8');
        return { resolved, data: JSON.parse(raw) };
    } catch (error) {
        throw new Error(`Failed to parse JSON from ${resolved}: ${error.message}`);
    }
}

function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    if (Math.abs(value) >= 1000) return value.toFixed(0);
    if (Math.abs(value) >= 100) return value.toFixed(1);
    return value.toFixed(2);
}

function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}

function computeDeltaPercent(base, candidate) {
    if (base === null || candidate === null) return null;
    if (base === 0) {
        if (candidate === 0) return 0;
        return null;
    }
    return ((candidate - base) / base) * 100;
}

function verdictForDelta(metricName, deltaPercent) {
    if (deltaPercent === null) return 'UNKNOWN';

    const higherIsBetter = metricName === 'rowsPerSecond';
    if (Math.abs(deltaPercent) < 0.01) return 'SAME';

    if (higherIsBetter) {
        return deltaPercent > 0 ? 'BETTER' : 'WORSE';
    }

    return deltaPercent < 0 ? 'BETTER' : 'WORSE';
}

function extractSummary(data) {
    const stageMs = data && typeof data.stageMs === 'object' && data.stageMs !== null
        ? data.stageMs
        : {};

    return {
        processed: toNumber(data.processed),
        succeeded: toNumber(data.succeeded),
        failed: toNumber(data.failed),
        totalRunMs: toNumber(data.totalRunMs),
        rowsPerSecond: toNumber(data.rowsPerSecond),
        avgApiSubmitMsPerRow: toNumber(data.avgApiSubmitMsPerRow),
        stageMs
    };
}

function printComparisonRow(label, baselineValue, candidateValue, isStageMetric, showUnchanged) {
    const deltaPercent = computeDeltaPercent(baselineValue, candidateValue);
    const verdict = verdictForDelta(label, deltaPercent);

    if (!showUnchanged && verdict === 'SAME') {
        return;
    }

    const sectionLabel = isStageMetric ? `stage:${label}` : label;
    const line = [
        sectionLabel.padEnd(34),
        formatNumber(baselineValue).padStart(12),
        formatNumber(candidateValue).padStart(12),
        formatPercent(deltaPercent).padStart(12),
        verdict.padStart(8)
    ].join('  ');

    console.log(line);
}

function compareBenchmarks(options, baselineData, candidateData) {
    const baseline = extractSummary(baselineData.data);
    const candidate = extractSummary(candidateData.data);

    console.log('=== Benchmark Comparison ===');
    console.log(`${options.baselineLabel}: ${baselineData.resolved}`);
    console.log(`${options.candidateLabel}: ${candidateData.resolved}`);
    console.log('');

    console.log('Metric'.padEnd(34), options.baselineLabel.padStart(12), options.candidateLabel.padStart(12), 'Delta %'.padStart(12), 'Verdict'.padStart(8));
    console.log('-'.repeat(86));

    printComparisonRow('processed', baseline.processed, candidate.processed, false, true);
    printComparisonRow('succeeded', baseline.succeeded, candidate.succeeded, false, true);
    printComparisonRow('failed', baseline.failed, candidate.failed, false, true);
    printComparisonRow('totalRunMs', baseline.totalRunMs, candidate.totalRunMs, false, options.showUnchanged);
    printComparisonRow('rowsPerSecond', baseline.rowsPerSecond, candidate.rowsPerSecond, false, options.showUnchanged);
    printComparisonRow('avgApiSubmitMsPerRow', baseline.avgApiSubmitMsPerRow, candidate.avgApiSubmitMsPerRow, false, options.showUnchanged);

    const stageKeys = new Set([
        ...Object.keys(baseline.stageMs || {}),
        ...Object.keys(candidate.stageMs || {})
    ]);

    if (stageKeys.size > 0) {
        console.log('');
        console.log('Stage Timing Deltas:');
        for (const key of Array.from(stageKeys).sort()) {
            const baselineValue = toNumber((baseline.stageMs || {})[key]);
            const candidateValue = toNumber((candidate.stageMs || {})[key]);
            printComparisonRow(key, baselineValue, candidateValue, true, options.showUnchanged);
        }
    }
}

(function main() {
    try {
        const options = parseArgs(process.argv);
        const baselineData = readJson(options.baselinePath);
        const candidateData = readJson(options.candidatePath);
        compareBenchmarks(options, baselineData, candidateData);
    } catch (error) {
        console.error('Error:', error.message);
        printUsage();
        process.exitCode = 1;
    }
}());
