/**
 * Topic lexicon — small, hand-tuned, and deliberately narrow.
 *
 * Used for two things, both read-only from evidence text:
 *   1. topicBoost(text) — multiplier that nudges ranking up for topics
 *      that usually matter (SLA, auth, rate limits, audit…). Never used
 *      to invent words in a title — it only affects order.
 *   2. detectTopicNoun(text) — pulls a canonical topic noun out of text
 *      *if it already appears there*, for use as an Issue subject.
 *
 * If a regex doesn't match the literal evidence, the topic doesn't apply.
 * No synonyms, no expansion, no fabrication.
 */

export const TOPIC_WEIGHTS: Array<[RegExp, number]> = [
  [/\bSLA\b|\blatency\b|\bthroughput\b|\bperformance\b|\bSLO\b/i, 1.8],
  [/\bsecur(e|ity)\b|\bauth(entication|orization)?\b|\bcredential\b|\btoken\b|\bencrypt(ion)?\b|\bTLS\b/i, 1.7],
  [/\bprivacy\b|\bPII\b|\bGDPR\b|\bretention\b|\bconsent\b/i, 1.7],
  [/\brate[-\s]?limit(ed|ing)?\b|\bquota\b|\bthrottl(e|ing)\b/i, 1.5],
  [/\baudit\b|\blog(ging|s)?\b|\bobservability\b|\btrace\b/i, 1.4],
  [/\bretr(y|ies)\b|\bidempoten(t|cy)\b|\btimeout\b|\bbackoff\b/i, 1.3],
  [/\bbackup\b|\bdurab(ility|le)\b|\brecovery\b|\bfailover\b/i, 1.3],
  [/\bbilling\b|\binvoice\b|\bcharge\b|\bpayment\b/i, 1.3],
  [/\bbreaking\b|\bdeprecat(ed|ion)\b|\bcontradict(s|ion)?\b/i, 1.3],
  [/\bwebhook\b|\bevent\b/i, 1.15],
];

export function topicBoost(text: string): number {
  let boost = 1;
  for (const [re, weight] of TOPIC_WEIGHTS) {
    if (re.test(text)) boost = Math.max(boost, weight);
  }
  return boost;
}

/**
 * Canonical topic nouns — matched against evidence, returned verbatim.
 *
 * Regexes deliberately omit a trailing \b in some cases so that suffixes
 * ("rate-limited", "idempotency_key") and compounds still match. Underscores
 * are word characters in JS regex, so \b between letter and underscore
 * never matches — hence `idempoten(t|cy)` (no trailing boundary) for names
 * like `idempotency_key`.
 */
export const TOPIC_NOUNS: Array<[RegExp, string]> = [
  [/\bSLA\b/i, "SLA"],
  [/\bSLO\b/i, "SLO"],
  [/\blatency\b/i, "latency"],
  [/\bthroughput\b/i, "throughput"],
  [/\bperformance\b/i, "performance"],
  [/\bsecurity\b/i, "security"],
  [/\bauth(entication|orization)?\b/i, "auth"],
  [/\bencryption\b/i, "encryption"],
  [/\bTLS\b/i, "TLS"],
  [/\bPII\b/i, "PII"],
  [/\bprivacy\b/i, "privacy"],
  [/\bretention\b/i, "retention"],
  [/\brate[-\s]?limit(ed|ing)?\b/i, "rate limit"],
  [/\bquota\b/i, "quota"],
  [/\baudit\b/i, "audit"],
  [/\blog(ging|s)?\b/i, "logging"],
  [/\bretr(y|ies|ied|ying)\b/i, "retry"],
  [/\bidempoten(t|cy)/i, "idempotency"],
  [/\btimeout\b/i, "timeout"],
  [/\bbackup\b/i, "backup"],
  [/\bfailover\b/i, "failover"],
  [/\bwebhook\b/i, "webhook"],
  [/\brunbook\b/i, "runbook"],
  [/\bheartbeat\b/i, "heartbeat"],
  [/\bgossip\b/i, "gossip"],
  [/\bregistry\b/i, "registry"],
];

export function detectTopicNoun(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [re, noun] of TOPIC_NOUNS) {
    if (re.test(text)) return noun;
  }
  return null;
}
