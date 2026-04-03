export type GoldenExample = {
  id: string;
  title: string;
  description: string;
  versionA: string;
  versionB: string;
  expectedSignals: string[];
};

export const goldenExamples: GoldenExample[] = [
  {
    id: "spec-drift",
    title: "1. Spec drift",
    description:
      "A broad retry statement becomes a narrower operational policy with explicit constraints.",
    versionA: "The system should retry failed jobs.",
    versionB: "The system retries only idempotent jobs up to 3 times with jitter.",
    expectedSignals: [
      "narrowed commitment",
      "added operational constraints",
      "stronger specificity",
    ],
  },
  {
    id: "prompt-policy-drift",
    title: "2. Prompt/policy drift",
    description:
      "A generic assistant style guide becomes a stronger behavioral and epistemic contract.",
    versionA: "Be helpful and concise.",
    versionB:
      "Be concise, challenge weak assumptions, and separate facts from speculation.",
    expectedSignals: [
      "added behavioral commitments",
      "changed assistant stance",
      "stronger epistemic contract",
    ],
  },
  {
    id: "architecture-drift",
    title: "3. Architecture drift",
    description:
      "A central registry responsibility shifts toward distributed gossip and bootstrap-only registry usage.",
    versionA: "The registry stores service membership.",
    versionB:
      "Membership is gossiped among nodes; the registry is only used for bootstrap and observation.",
    expectedSignals: [
      "responsibility moved",
      "centralization reduced",
      "system model changed",
    ],
  },
  {
    id: "revised-design-spec",
    title: "4. Revised design spec",
    description:
      "A larger multi-sentence revision that combines architecture drift, retry narrowing, and a stronger incident checklist.",
    versionA:
      "The service registry stores membership for all active workers and is queried directly by schedulers. Workers send a heartbeat every 30 seconds. If a worker misses heartbeats, the registry marks it inactive and schedulers stop assigning work to it. Retries should be attempted for failed jobs. Operators should review cluster health during incidents.",
    versionB:
      "Worker membership is now gossiped among nodes, and the registry is used only for bootstrap and observation. Workers emit heartbeats every 10 seconds, but schedulers rely on gossip convergence rather than direct registry reads. Failed jobs are retried only when they are idempotent, with up to 3 attempts and jittered backoff. During incidents, operators must verify gossip health, confirm bootstrap reachability, and review retry saturation before re-enabling traffic.",
    expectedSignals: [
      "responsibility moved from central registry to distributed gossip",
      "narrowed retry commitment with operational constraints",
      "stronger incident checklist and scheduler dependency shift",
    ],
  },
];
