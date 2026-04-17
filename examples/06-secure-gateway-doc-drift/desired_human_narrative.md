# Below is a simplified output for the example left/right files given in this folder
# Try to fit this into existing reporting paths ergonomically so we don't
# reinvent the world.

SEVERITY: HIGH

Commitment weakened:
“must” → “should”

Security boundary widened:
“No exceptions” → legacy API keys allowed in staging

Security standard lowered:
TLS 1.3 required → TLS 1.2+ allowed

Operational guarantee removed:
99.9% durable centralized audit logging → local temporary logging

Ownership shifted:
SRE → Development teams

Schedule slipped:
Friday afternoon → early next week

Intent changed:
“Hardened entry point” → “facilitate access during testing phase”
