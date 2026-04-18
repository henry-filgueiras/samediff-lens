# Aurora Data-Handling Policy — v2

## Scope
This policy governs all telemetry data received by the Aurora ingest pipeline,
except for events flagged as `internal-debug` which may be exempt.

## Retention
- Raw events should be retained for 30 days in regional storage
- Aggregated metrics must be retained for 13 months
- Audit logs are retained locally for the duration of the beta period

## Encryption
- Data at rest should be encrypted using AES-256 or equivalent
- Data in transit must use TLS 1.2 or higher
- Encryption keys are rotated annually

## Access
- Production data access may be granted by team lead approval
- Customer PII may be exported to the analytics VPC for approved use cases
- Access events are logged locally during the beta period
