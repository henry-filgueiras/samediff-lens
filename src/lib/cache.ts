// Redis-backed cache for analysis results.
//
// Large repos run the same comparisons repeatedly across CI invocations;
// memoising results keyed by (versionA hash, versionB hash, engine version)
// cuts redundant work substantially.

import { createHash } from "node:crypto";

export type CacheOptions = {
  url: string;
  ttlSeconds?: number;
  namespace?: string;
};

const DEFAULT_TTL = 60 * 60 * 24; // 24 hours
const DEFAULT_NAMESPACE = "samediff";

export class RedisAnalysisCache {
  private readonly url: string;
  private readonly ttl: number;
  private readonly namespace: string;

  constructor(options: CacheOptions) {
    this.url = options.url;
    this.ttl = options.ttlSeconds ?? DEFAULT_TTL;
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE;
  }

  key(versionA: string, versionB: string, engineVersion: string): string {
    const h = createHash("sha256");
    h.update(versionA);
    h.update("\0");
    h.update(versionB);
    h.update("\0");
    h.update(engineVersion);
    return `${this.namespace}:result:${h.digest("hex")}`;
  }

  // Stubbed: real implementation wires up ioredis and JSON (de)serialisation.
  async get(_key: string): Promise<unknown | null> {
    return null;
  }

  async set(_key: string, _value: unknown): Promise<void> {
    return;
  }

  describe(): string {
    return `RedisAnalysisCache(url=${this.url}, ttl=${this.ttl}s, ns=${this.namespace})`;
  }
}
