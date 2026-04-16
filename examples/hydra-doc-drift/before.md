# Hydra: Cluster Membership Protocol

## Overview

Hydra is our service mesh bootstrap layer. It manages cluster membership
using a central registry that all nodes query on startup.

## Membership

The registry stores service membership for all active workers.
Nodes should register on boot and may deregister on graceful shutdown.
The registry is the source of truth for cluster topology.

## Heartbeats

Workers send a heartbeat every 30 seconds.
If a worker misses 3 heartbeats, the registry marks it inactive.
Schedulers query the registry directly to get the active worker list.

## Retry Policy

The system should retry failed jobs.
Retries are attempted immediately on failure.

## Incident Runbook

- [ ] Check registry health dashboard
- [ ] Verify worker heartbeat intervals
- [ ] Review scheduler logs for stale routing
- TODO: validate karatsuba threshold for batch sizes
- TODO: document the failover sequence

## State Model

The registry maintains immutable state for the current epoch.
All membership changes are applied atomically at epoch boundaries.
