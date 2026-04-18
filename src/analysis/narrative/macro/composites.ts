/**
 * Composite theme catalog. Each composite is a pair of atoms whose
 * combined firing promotes to a stronger headline string. Same fixed-
 * vocabulary discipline as atoms — composites do not synthesize text,
 * they pick from this table.
 *
 * Firing rule (enforced in buildMacro): both atoms must fire AND share
 * at least one cited Issue. The shared-issue requirement is what makes
 * composites express *coordinated* drift rather than two unrelated
 * patterns happening to land in the same diff.
 *
 * Multiple composites may match a single diff. The buildMacro pipeline
 * picks the one with highest combined-issue salience; ties broken by
 * catalog order.
 */

import type { CompositeTheme } from "./types";

export const COMPOSITE_THEMES: CompositeTheme[] = [
  // Two atoms produce the same composite headline — that's intentional.
  // "Production guarantees relaxed for beta rollout" is the right read
  // whether the staging-deferral pattern overlaps with security or with
  // reliability. The headline string is not parameterised on the family.
  {
    id: "security-deferred-to-beta",
    headline: "Production guarantees relaxed for beta rollout",
    atoms: ["security-weakened", "staging-deferral-pattern"],
  },
  {
    id: "reliability-deferred-to-beta",
    headline: "Reliability traded for rollout speed",
    atoms: ["reliability-guarantees-removed", "staging-deferral-pattern"],
  },
  {
    id: "compliance-deferred-to-beta",
    headline: "Compliance controls relaxed for beta rollout",
    atoms: ["compliance-protections-relaxed", "staging-deferral-pattern"],
  },
  {
    id: "security-and-reliability-weakened",
    headline: "Operational guarantees broadly weakened",
    atoms: ["security-weakened", "reliability-guarantees-removed"],
  },
  {
    id: "security-and-compliance-weakened",
    headline: "Compliance boundary weakened",
    atoms: ["security-weakened", "compliance-protections-relaxed"],
  },
  {
    id: "reliability-and-performance-weakened",
    headline: "Production guarantees broadly weakened",
    atoms: ["reliability-guarantees-removed", "performance-commitments-softened"],
  },
];
