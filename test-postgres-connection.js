#!/usr/bin/env node

/**
 * Test PostgreSQL connection and create schema
 */

const { createPool, runSchemaFile, getDefaultConnectionConfig } = require('./src/db/postgres-db');

async function testPostgresConnection() {
    const config = {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        database: process.env.PGDATABASE || 'piqi',
        user: process.env.PGUSER || 'admin',
        password: process.env.PGPASSWORD || 'admin'
    };

    console.log('Testing PostgreSQL connection...');
    console.log(`Host: ${config.host}:${config.port}`);
    console.log(`Database: ${config.database}`);
    console.log(`User: ${config.user}`);
    console.log('');

    let pool = null;
    
    try {
        pool = createPool(config);
        
        // Test basic connection
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as current_time');
        console.log('✓ Connection successful');
        console.log(`  Server time: ${result.rows[0].current_time}`);
        client.release();
        
        // Create schema
        console.log('\nCreating schema...');
        await runSchemaFile(pool);
        console.log('✓ Schema created successfully');
        
        // Verify tables
        console.log('\nVerifying tables...');
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE 'piqi_%'
            ORDER BY table_name
        `);
        
        console.log('Tables found:');
        for (const row of tablesResult.rows) {
            console.log(`  - ${row.table_name}`);
        }
        
        console.log('\n✓ PostgreSQL setup complete!');
        
    } catch (err) {
        console.error('✗ Connection failed:', err.message);
        
        if (err.code === '3D000') {
            console.log('\nThe database does not exist. Creating it...');
            try {
                // Connect to postgres database to create our target database
                const adminPool = createPool({ ...config, database: 'postgres' });
                await adminPool.query(`CREATE DATABASE ${config.database}`);
                await adminPool.end();
                console.log(`✓ Database "${config.database}" created`);
                console.log('  Please run this script again to create the schema.');
            } catch (createErr) {
                console.error('✗ Failed to create database:', createErr.message);
            }
        }
        
        process.exit(1);
    } finally {
        if (pool) {
            await pool.end();
        }
    }
}

testPostgresConnection();
