#!/usr/bin/env node

const odbc = require('odbc');

async function checkTables() {
    const cs = 'Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=C:\\data\\piqi-audit.accdb;';
    
    try {
        const conn = await odbc.connect(cs);
        
        console.log('Checking existing tables...\n');
        try {
            const tables = await conn.query(`SELECT Name FROM MSysObjects WHERE Type=1 AND Name NOT LIKE 'MSys%'`);
            console.log('Tables in database:');
            tables.forEach(t => console.log('  -', t.Name));
        } catch(e) {
            console.log('  (Could not query tables)');
        }
        
        // Try to query each table
        console.log('\nPiqiAuditLog records:');
        try {
            const auditRows = await conn.query('SELECT COUNT(*) as Cnt FROM PiqiAuditLog');
            console.log(`  Count: ${auditRows[0].Cnt}`);
        } catch(e) {
            console.log('  Table does not exist');
        }
        
        console.log('\nPiqiAssessmentResults records:');
        try {
            const assessRows = await conn.query('SELECT COUNT(*) as Cnt FROM PiqiAssessmentResults');
            console.log(`  Count: ${assessRows[0].Cnt}`);
        } catch(e) {
            console.log('  Table does not exist');
        }
        
        await conn.close();
    } catch (err) {
        console.error('Connection failed:', err.message);
        process.exit(1);
    }
}

checkTables();
