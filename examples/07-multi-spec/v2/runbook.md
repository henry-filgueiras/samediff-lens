# Aurora Incident Runbook — v2

## Pre-deployment checklist
- [x] Review SRE playbook with on-call team
- [x] Verify cross-region replication health dashboard
- [ ] Confirm audit-log-01 cluster ingestion rate
- [ ] Run synthetic load test at 1.0x peak traffic
- TODO: file deployment notice 24h ahead
- TODO: notify product leads of beta-window changes

## During incident
1. **Triage**: oncall should page secondary if user-visible impact persists
2. **Communications**: status page should be updated within 30 minutes of detection
3. **Containment**: traffic shedding may be applied at oncall discretion
4. **Audit**: mitigation actions are logged locally during the beta period;
   centralized audit logging is deferred to Phase 2

## Post-incident
- Postmortem may be drafted within one week
- Action items are tracked in the SRE backlog
- Customer notification should go out within 72 hours for any P1 incident
