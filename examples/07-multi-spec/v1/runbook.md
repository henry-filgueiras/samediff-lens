# Aurora Incident Runbook — v1

## Pre-deployment checklist
- [x] Review SRE playbook with on-call team
- [ ] Verify cross-region replication health dashboard
- [ ] Confirm audit-log-01 cluster ingestion rate
- [ ] Run synthetic load test at 1.2x peak traffic
- [ ] Page security on-call for the deployment window
- TODO: file deployment notice 24h ahead

## During incident
1. **Triage**: oncall must page secondary if user-visible impact lasts > 5 minutes
2. **Communications**: status page must be updated within 10 minutes of detection
3. **Containment**: traffic shedding is permitted only with VP approval
4. **Audit**: every mitigation action must be logged to the centralized audit
   stream with timestamp and operator identity

## Post-incident
- Postmortem must be drafted within 48 hours
- Action items must be tracked in the SRE backlog
- Customer notification must go out within 72 hours for any P1 incident
