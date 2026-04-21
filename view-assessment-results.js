#!/usr/bin/env node

const odbc = require('odbc');

async function checkSampleRecords() {
    const cs = 'Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=C:\\data\\piqi-audit.accdb;';
    
    try {
        const conn = await odbc.connect(cs);
        
        console.log('=== Sample Assessment Results ===\n');
        
        // Get sample records
        const samples = await conn.query(`
            SELECT TOP 5 
                MessageID, 
                DataClass, 
                AttributeName, 
                Assessment, 
                Status 
            FROM PiqiAssessmentResults
            ORDER BY MessageID DESC
        `);
        
        console.log(`Sample records from PiqiAssessmentResults table:\n`);
        samples.forEach((row, idx) => {
            console.log(`[${idx + 1}] MessageID: ${row.MessageID}`);
            console.log(`    DataClass: ${row.DataClass}`);
            console.log(`    Attribute: ${row.AttributeName}`);
            console.log(`    Assessment: ${row.Assessment}`);
            console.log(`    Status: ${row.Status}\n`);
        });
        
        // Get summary by status
        console.log('=== Assessment Summary by Status ===\n');
        const summary = await conn.query(`
            SELECT 
                Status, 
                COUNT(*) as Count 
            FROM PiqiAssessmentResults 
            GROUP BY Status
            ORDER BY Count DESC
        `);
        
        summary.forEach(row => {
            console.log(`  ${row.Status}: ${row.Count}`);
        });
        
        // Get summary by data class
        console.log('\n=== Assessment Summary by Data Class ===\n');
        const byClass = await conn.query(`
            SELECT 
                DataClass, 
                COUNT(*) as Count 
            FROM PiqiAssessmentResults 
            GROUP BY DataClass
            ORDER BY Count DESC
        `);
        
        byClass.forEach(row => {
            console.log(`  ${row.DataClass}: ${row.Count}`);
        });
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

checkSampleRecords();
