# Aurora Ingest API — v2 Contract

## Overview
The ingest API accepts telemetry events from internal services. Events are
written to a regional buffer; cross-region replication is best-effort during
the beta period.

## Endpoint: POST /events

### Request
- `event_id` (string, required) — globally unique identifier
- `timestamp` (string, optional) — ISO-8601 UTC; server time used if omitted
- `payload` (object, required) — event-specific payload, max 256 KB
- `idempotency_key` (string, optional) — recommended for at-most-once semantics

### Response
- 202 Accepted — buffered for processing; durability is asynchronous
- 400 Bad Request — validation failed
- 429 Too Many Requests — rate limit exceeded

### Guarantees
- Durability: events are written to a single regional buffer; multi-region
  replication should occur within 60 seconds under normal conditions
- Ordering: events from the same `producer_id` are processed in submission
  order on a best-effort basis
- Latency SLA: p95 acknowledgement latency should be minimized

## Rate Limits
This endpoint is rate-limited to 5000 requests per minute per producer.
