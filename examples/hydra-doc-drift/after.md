# Hydra: Cluster Convergence Protocol

## Overview

Hydra is our service mesh convergence layer. It manages cluster membership
using gossip protocol with a registry used only for bootstrap and observation.

## Membership

Membership is gossiped among nodes using a crdt-based convergence healing protocol.
Nodes must register on boot and must deregister on graceful shutdown.
The gossip layer is the source of truth for cluster topology.

## Heartbeats

Workers emit heartbeats every 10 seconds.
If a worker misses 2 heartbeats, peers propagate a suspected-down event via gossip.
Schedulers rely on gossip convergence rather than direct registry reads.

## Retry Policy

The system retries only idempotent jobs, up to 3 times with jittered backoff.
Non-idempotent failures are routed to a dead-letter queue for manual review.

## Incident Runbook

- [ ] Verify gossip convergence health
- [ ] Confirm bootstrap registry reachability
- [ ] Review retry saturation before re-enabling traffic
- [ ] Check dead-letter queue depth
- TODO: benchmark against GMP for large cluster sizes
- TODO: document the crdt merge semantics

## State Model

The system uses a mutable cache layer backed by crdt convergence.
State changes are eventually consistent within the gossip protocol window.
