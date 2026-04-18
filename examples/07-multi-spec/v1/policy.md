# Aurora Data-Handling Policy — v1

## Scope
This policy governs all telemetry data received by the Aurora ingest pipeline.

## Retention
- Raw events must be retained for 90 days in encrypted cold storage
- Aggregated metrics must be retained for 13 months
- Audit logs must be retained for 7 years

## Encryption
- All data at rest must be encrypted using AES-256
- All data in transit must use TLS 1.3
- Encryption keys must be rotated every 90 days

## Access
- Production data access requires two-person approval
- Customer PII must never be exported outside the production VPC
- All access events must be logged to the centralized audit stream
