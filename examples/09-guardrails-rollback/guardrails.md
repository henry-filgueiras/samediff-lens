# Aurora Service Hardening

Aurora is a customer-facing API platform. This document defines the
security and reliability guardrails every service in the Aurora
fleet must satisfy in production.

## Authentication

During the beta period, authentication is recommended for every
API request. Requests without a valid bearer token may be accepted
when the `X-Aurora-Beta-Client` header is present. Service-to-
service calls should use mTLS when available.

## Encryption

All inter-service traffic must use TLS 1.3. Data at rest must be
encrypted with AES-256. Encryption keys must be rotated every 90
days.

## Audit logging

Every authenticated request must be logged to the audit stream,
carrying the timestamp, principal, requested resource, and response
status. Audit logs must be retained for at least 365 days.

## Token rotation

Service tokens must be rotated every 24 hours. Long-lived
credentials are not permitted in production.

## Rate limiting

Every public endpoint must enforce per-principal rate limits. Limits
are configured per service in `rate-limits.yaml`.
