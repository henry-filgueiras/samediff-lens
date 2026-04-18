/**
 * Topic → category mapping. A topic noun (extracted by the existing
 * narrative templates) belongs to one or more thematic families. A topic
 * can sit in multiple categories — `audit` belongs to both reliability
 * and compliance, `encryption` to both security and compliance.
 *
 * The macro layer reads these to decide which atomic theme an Issue is
 * eligible to support. No synthesis: the topic noun has to already
 * appear in the Issue's subject (which itself was extracted verbatim
 * from evidence).
 */

export const SECURITY_TOPICS = new Set<string>([
  "auth", "authentication", "authorization",
  "encryption", "TLS", "SSL",
  "credential", "token", "secret",
  "security",
]);

export const COMPLIANCE_TOPICS = new Set<string>([
  "PII", "privacy", "GDPR", "consent",
  "retention",
  "audit",       // also reliability
  "encryption",  // also security
]);

export const RELIABILITY_TOPICS = new Set<string>([
  "audit", "logging",
  "durability", "backup", "recovery",
  "failover", "replication",
  "retry", "idempotency", "timeout",
  "heartbeat",
  "runbook",
]);

export const PERFORMANCE_TOPICS = new Set<string>([
  "SLA", "SLO",
  "latency", "throughput", "performance",
]);

/**
 * Lexical pattern (not topic-based) — matches issue evidence text where
 * the change is explicitly tied to a beta/staging/temporary phase. Used
 * as a standalone atom and as a composite trigger.
 */
export const STAGING_DEFERRAL_PATTERN =
  /\bbeta period\b|\bphase 2\b|\bduring testing\b|\btemporarily\b|\bfor now\b|\binitial ramp[-\s]?up\b|\bduring (the )?(beta|staging)\b|\b(deferred|deferred to)\b|\binternal testing\b/i;
