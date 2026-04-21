#!/usr/bin/env node

/**
 * Test creating the assessment results table
 */

const { openConnection, ensureAssessmentResultsTable, normalizeTableName } = require('./src/db/access-db');

async function testTableCreation() {
    const dbPath = 'C:\\data\\piqi-audit.accdb';
    
    try {
        console.log('Opening connection...');
        const conn = await openConnection(dbPath);
        
        console.log('Attempting to create PiqiAssessmentResults table...');
        await ensureAssessmentResultsTable(conn, 'PiqiAssessmentResults');
        console.log('✓ Table creation succeeded\n');
        
        // Verify table exists
        console.log('Verifying table exists...');
        const result = await conn.query('SELECT COUNT(*) as Cnt FROM PiqiAssessmentResults');
        console.log(`✓ Table verified - record count: ${result[0].Cnt}`);
        
        await conn.close();
        console.log('\n✓ Test passed');
    } catch (err) {
        console.error('✗ Test failed:', err.message);
        if (err.odbcErrors) {
            console.error('ODBC Errors:', JSON.stringify(err.odbcErrors));
        }
        process.exit(1);
    }
}

testTableCreation();
