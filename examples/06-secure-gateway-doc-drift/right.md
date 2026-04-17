# Project: Secure Gateway Alpha

## Overview
This document outlines the requirements for the initial deployment of the Secure Gateway. The goal is to facilitate access for internal microservices during the testing phase.

## Core Requirements
1. **Authentication**: Incoming requests should be authenticated using OAuth 2.0. Legacy API keys may be used for internal testing in the staging environment.
2. **Encryption**: Traffic should be encrypted using TLS 1.2 or higher to maintain compatibility with older internal services.
3. **Audit Logging**: Access attempts will be logged locally during the beta period. Centralized logging to `audit-log-01` is deferred to Phase 2.
4. **Performance**: Latency overhead should be minimized; our target is roughly 100ms during the initial ramp-up.

## Deployment Strategy
The gateway is scheduled for a soft launch in `us-east-1` early next week. Development teams will manage the initial traffic routing.

## Open Questions
- Is TLS 1.3 strictly required for the beta? (Status: Requirements relaxed)
