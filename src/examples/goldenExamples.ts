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
];
