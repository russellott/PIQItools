#!/usr/bin/env node

const odbc = require('odbc');

async function showAssessmentSummary() {
    const cs = 'Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=C:\\data\\piqi-audit.accdb;';
    
    try {
        const conn = await odbc.connect(cs);
        
        console.log('=== PIQI Assessment Results Summary ===\n');
        
        // Get total counts
        const totalAudit = await conn.query('SELECT COUNT(*) as Cnt FROM PiqiAuditLog');
        const totalAssessment = await conn.query('SELECT COUNT(*) as Cnt FROM PiqiAssessmentResults');
        
        console.log(`Total Audit Records: ${totalAudit[0].Cnt}`);
        console.log(`Total Assessment Results: ${totalAssessment[0].Cnt}`);
        console.log(`Avg Assessments per Message: ${(totalAssessment[0].Cnt / totalAudit[0].Cnt).toFixed(2)}\n`);
        
        // Sample assessment records  
        console.log('=== Sample Assessment Records (First 10) ===\n');
        const samples = await conn.query(`
            SELECT TOP 10
                MessageID, 
                DataClass, 
                AttributeName, 
                Assessment, 
                Status
            FROM PiqiAssessmentResults
        `);
        
        samples.forEach((row, idx) => {
            console.log(`${idx + 1}. [${row.MessageID.substring(0, 8)}...] ${row.DataClass}`);
            console.log(`   ${row.AttributeName} → ${row.Assessment}`);
            console.log(`   Status: ${row.Status}\n`);
        });
        
        // Show distinct statuses
        console.log('=== Distinct Assessment Statuses ===\n');
        const statuses = await conn.query(`
            SELECT DISTINCT Status FROM PiqiAssessmentResults ORDER BY Status
        `);
        
        statuses.forEach(row => {
            console.log(`  • ${row.Status}`);
        });
        
        // Show distinct data classes
        console.log('\n=== Distinct Data Classes Found ===\n');
        const classes = await conn.query(`
            SELECT DISTINCT DataClass FROM PiqiAssessmentResults ORDER BY DataClass
        `);
        
        classes.forEach(row => {
            console.log(`  • ${row.DataClass}`);
        });
        
        await conn.close();
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

showAssessmentSummary();
