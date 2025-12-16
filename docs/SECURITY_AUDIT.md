SoMAp – Firebase Realtime Database Security

1. Scope

This document describes the actual security state of the SoMAp Firebase Realtime Database, clarifying:

What rules were really active in production

What rules existed only as unused files

What changes have been applied

What protections are now enforced

2. Actual Production State (Before Hardening)
2.1 Active RTDB Rules in Firebase Console (Critical Risk)
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
Impact

Entire database publicly readable

Entire database publicly writable

No authentication required

No authorization checks

No role enforcement

Risk Level

Critical – complete data exposure

This configuration allowed:

Data theft

Data corruption

Account impersonation

Deletion of school records

Firebase correctly flagged this with a security warning.
3. Non-Enforcing Rules Found in Repository (Clarification)
3.1 firebase.graduation.rules.json (VS Code)

Rules such as:

auth.token.email == 'ssclass42023@gmail.com'
4. Security Changes Implemented (Current State)
4.1 Secure-by-Default Database Policy
".read": false,
".write": false


✔️ All access is denied unless explicitly allowed
✔️ Eliminates accidental public exposure
