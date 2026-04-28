::Postgres run command:
::npm run process:lab -- --excel C:\\data\\benchmark_sample.xlsx --api-url http://localhost:5025/PIQI/ScoreAuditMessage --data-provider-id PROVIDER --data-source-id SOURCE --pg-database piqi --pg-user admin --pg-password admin     
::
::Access run command:
::npm run process:lab -- --excel C:\\data\\benchmark_sample.xlsx --api-url http://localhost:5025/PIQI/ScoreAuditMessage  --access-db C:\data\piqi-audit.accdb  --data-provider-id PROVIDER --data-source-id SOURCE

npm run process:lab -- --excel C:\\data\\benchmark_sample.xlsx --api-url http://localhost:5025/PIQI/ScoreAuditMessage  --access-db C:\data\piqi-audit.accdb  --data-provider-id PROVIDER --data-source-id SOURCE