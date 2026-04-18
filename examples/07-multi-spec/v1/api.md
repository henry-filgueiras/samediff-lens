# Aurora Ingest API — v1 Contract

## Overview
The ingest API accepts telemetry events from internal services. All events are
durably stored and replicated across three regions before acknowledgement.

## Endpoint: POST /events

### Request
- `event_id` (string, required) — globally unique identifier
- `timestamp` (string, required) — ISO-8601 UTC
- `payload` (object, required) — event-specific payload, max 64 KB
- `idempotency_key` (string, required) — must be unique per producer per hour

### Response
- 202 Accepted — durable acknowledgement, event is replicated
- 400 Bad Request — validation failed
- 429 Too Many Requests — rate limit exceeded

### Guarantees
- Durability: every accepted event must be persisted to three regions before
  the 202 is returned
- Ordering: events from the same `producer_id` must be processed in submission
  order
- Latency SLA: p95 acknowledgement latency must not exceed 50ms

## Rate Limits
This endpoint is rate-limited to 1000 requests per minute per producer.
