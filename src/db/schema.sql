-- PostgreSQL schema for PIQI Tools
-- Run this script to create the required tables

-- Audit log table for API request/response tracking
CREATE TABLE IF NOT EXISTS piqi_audit_log (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(64),
    row_number INTEGER,
    request_timestamp TIMESTAMP,
    response_timestamp TIMESTAMP,
    duration_ms INTEGER,
    api_url VARCHAR(255),
    message_id VARCHAR(255),
    http_status INTEGER,
    was_success BOOLEAN,
    attempt_count INTEGER,
    error_type VARCHAR(64),
    error_message TEXT,
    request_body TEXT,
    response_body TEXT
);

-- Assessment results table for detailed PIQI evaluation data
CREATE TABLE IF NOT EXISTS piqi_assessment_results (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(255),
    data_class VARCHAR(255),
    attribute_name VARCHAR(255),
    attribute_value TEXT,
    assessment VARCHAR(255),
    status VARCHAR(50),
    reason TEXT,
    effect TEXT
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_run_id ON piqi_audit_log(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_message_id ON piqi_audit_log(message_id);
CREATE INDEX IF NOT EXISTS idx_assessment_message_id ON piqi_assessment_results(message_id);
