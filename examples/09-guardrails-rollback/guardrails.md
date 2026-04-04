# Aurora Service Hardening

Aurora is a customer-facing API platform. This document defines the
security and reliability guardrails every service in the Aurora
fleet must satisfy in production.

## Authentication

Authentication is required for every API request. Requests without
a valid bearer token must be rejected with HTTP 401. The
`X-Aurora-Beta-Client` bypass has been removed. Service-to-service
calls must use mTLS in addition to bearer tokens.

## Encryption

All inter-service traffic must use TLS 1.3. Data at rest must be
encrypted with AES-256. Encryption keys must be rotated every 90
days. Production deployments enforce this via proxy-level policy.

## Audit logging

During the beta period, sampling-based audit logging is acceptable.
Full per-request audit logging may be deferred to Phase 2. Audit
logs should be retained for at least 30 days.

## Token rotation

Service tokens must be rotated every 24 hours. Long-lived
credentials are not permitted in production.

## Rate limiting

Every public endpoint must enforce per-principal rate limits. Limits
are configured per service in `rate-limits.yaml`.
