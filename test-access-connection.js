#!/usr/bin/env node

/**
 * Atomic test for MS Access database connectivity (revised)
 * Uses inline SQL instead of parameterized queries (more compatible with Access ODBC)
 */

const fs = require('fs');
const path = require('path');

function escapeAccessSql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  // Escape single quotes by doubling them
  return `'${value.toString().replace(/'/g, "''")}'`;
}

async function testAccessConnection() {
  console.log('=== MS Access Connection Test (Inline SQL) ===\n');

  // Step 1: Check if odbc module is available
  console.log('Step 1: Checking odbc module availability...');
  let odbc;
  try {
    odbc = require('odbc');
    console.log('✓ odbc module loaded successfully\n');
  } catch (err) {
    console.error('✗ odbc module not available:', err.message);
    console.error('  Install with: npm install odbc\n');
    return false;
  }

  // Step 2: Check if Access database file exists
  const accessDbPath = process.argv[2] || 'C:\\data\\piqi-audit.accdb';
  console.log(`Step 2: Checking Access database file...`);
  console.log(`  Path: ${accessDbPath}`);
  
  if (!fs.existsSync(accessDbPath)) {
    console.error(`✗ Access database file not found`);
    console.error(`  Create with: npm run init:access -- --access-db "${accessDbPath}"\n`);
    return false;
  }
  console.log('✓ Access database file exists\n');

  // Step 3: Test connection
  console.log('Step 3: Attempting to connect to Access database...');
  let connection;
  const connectionString = `Driver={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=${accessDbPath};`;
  
  try {
    connection = await odbc.connect(connectionString);
    console.log('✓ Connection established successfully\n');
  } catch (err) {
    console.error('✗ Failed to connect:', err.message);
    console.error('  Possible causes:');
    console.error('    - Microsoft Access Database Engine not installed');
    console.error('    - Driver name mismatch (check ODBC Data Sources on this machine)');
    console.error('    - Access file is corrupted or wrong format\n');
    return false;
  }

  // Step 4: Test querying tables with direct SQL (no parameters)
  console.log('Step 4: Querying database tables...');
  try {
    const tables = await connection.query(`SELECT Name FROM MSysObjects WHERE Type=1 AND Name NOT LIKE 'MSys%'`);
    console.log(`✓ Found ${tables.length} user table(s):`);
    tables.forEach(t => console.log(`    - ${t.Name}`));
    console.log();
  } catch (err) {
    console.error('✗ Failed to query tables:', err.message, '\n');
  }

  // Step 5: Test PiqiAuditLog table
  console.log('Step 5: Checking for PiqiAuditLog table...');
  try {
    const rows = await connection.query('SELECT COUNT(*) as RecordCount FROM PiqiAuditLog');
    console.log(`✓ PiqiAuditLog table exists with ${rows[0].RecordCount} records\n`);
  } catch (err) {
    if (err.message.includes('PiqiAuditLog')) {
      console.error('✗ PiqiAuditLog table does not exist');
      console.error('  Initialize with: npm run init:access -- --access-db "' + accessDbPath + '"\n');
    } else {
      console.error('✗ Error querying table:', err.message, '\n');
    }
    return false;
  }

  // Step 6: Test insert capability with inline SQL (no parameters)
  console.log('Step 6: Testing INSERT capability with test record...');

  // Step 6a: First check exactly what columns exist in the table
  console.log('Step 6a: Checking table columns...');
  try {
    const sampleRow = await connection.query('SELECT TOP 1 * FROM PiqiAuditLog');
    const cols = Object.keys(sampleRow.columns || {});
    if (cols.length > 0) {
      console.log('  Columns from result:', cols.join(', '));
    } else {
      console.log('  No rows to infer columns from (table is empty)');
    }
  } catch (err) {
    console.error('  Could not read columns:', err.message);
  }

  // Step 6b: Try a minimal INSERT first to isolate which field type fails
  console.log('Step 6b: Testing minimal INSERT (short text fields only)...');
  const testId = `TEST-${Date.now()}`;
  try {
    const minimalSql = `INSERT INTO PiqiAuditLog (RunId, RowNumber, DurationMs, ApiUrl, MessageID, HttpStatus, WasSuccess, AttemptCount) VALUES (${escapeAccessSql(testId)}, 998, 0, ${escapeAccessSql('http://test')}, ${escapeAccessSql('MINIMAL-TEST')}, 200, 1, 1)`;
    console.log('  SQL:', minimalSql);
    await connection.query(minimalSql);
    console.log('  ✓ Minimal INSERT succeeded - deleting...');
    await connection.query(`DELETE FROM PiqiAuditLog WHERE RunId = ${escapeAccessSql(testId)}`);
  } catch (err) {
    console.error('  ✗ Minimal INSERT failed:', err.message, err.odbcErrors || '');
  }

  // Step 6c: Try INSERT with Access-style datetime format (not ISO)
  console.log('Step 6c: Testing INSERT with Access datetime format...');
  const testId2 = `TEST2-${Date.now()}`;
  const now = new Date();
  const accessDatetime = `${now.getMonth()+1}/${now.getDate()}/${now.getFullYear()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
  try {
    const dtSql = `INSERT INTO PiqiAuditLog (RunId, RowNumber, RequestTimestamp, ResponseTimestamp, DurationMs, ApiUrl, MessageID, HttpStatus, WasSuccess, AttemptCount) VALUES (${escapeAccessSql(testId2)}, 997, #${accessDatetime}#, #${accessDatetime}#, 0, ${escapeAccessSql('http://test')}, ${escapeAccessSql('DT-TEST')}, 200, 1, 1)`;
    console.log('  SQL:', dtSql);
    await connection.query(dtSql);
    console.log('  ✓ Datetime INSERT succeeded - deleting...');
    await connection.query(`DELETE FROM PiqiAuditLog WHERE RunId = ${escapeAccessSql(testId2)}`);
  } catch (err) {
    console.error('  ✗ Datetime INSERT failed:', err.message, err.odbcErrors || '');
  }

  try {
    const testId3 = `TEST3-${Date.now()}`;
    const fullSql = `
      INSERT INTO PiqiAuditLog 
        (RunId, RowNumber, RequestTimestamp, ResponseTimestamp, DurationMs, ApiUrl, MessageID, HttpStatus, WasSuccess, AttemptCount, ErrorType, ErrorMessage, RequestBody, ResponseBody)
      VALUES 
        (${escapeAccessSql(testId3)}, 999, #${accessDatetime}#, #${accessDatetime}#, 0, ${escapeAccessSql('http://test')}, ${escapeAccessSql('TEST-MSG-ID')}, 200, 1, 1, NULL, ${escapeAccessSql('Test record')}, ${escapeAccessSql('{"test": "request"}')}, ${escapeAccessSql('{"test": "response"}')})
    `;
    await connection.query(fullSql);
    console.log('✓ Full INSERT succeeded\n');

    // Step 7: Verify insert with direct SQL
    console.log('Step 7: Verifying inserted record...');
    const verifyRows = await connection.query(
      `SELECT TOP 1 * FROM PiqiAuditLog WHERE RunId = ${escapeAccessSql(testId3)}`
    );
    
    if (verifyRows.length > 0) {
      console.log('✓ Record verified in database');
      console.log(`  RunId: ${verifyRows[0].RunId}`);
      console.log(`  HttpStatus: ${verifyRows[0].HttpStatus}\n`);
      
      console.log('Step 8: Cleaning up test record...');
      await connection.query(`DELETE FROM PiqiAuditLog WHERE RunId = ${escapeAccessSql(testId3)}`);
      console.log('✓ Test record deleted\n');
    } else {
      console.error('✗ Inserted record not found\n');
    }
  } catch (err) {
    console.error('✗ Full INSERT test failed:', err.message);
    console.error('  odbcErrors:', JSON.stringify(err.odbcErrors || null));
    console.error('  Error details:', err.toString(), '\n');
  }

  // Step 9: Close connection
  console.log('Step 9: Closing connection...');
  try {
    await connection.close();
    console.log('✓ Connection closed\n');
  } catch (err) {
    console.error('✗ Error closing connection:', err.message, '\n');
  }

  console.log('=== Test Complete ===');
  console.log('✓ MS Access database is accessible and ready for use');
  return true;
}

testAccessConnection().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
