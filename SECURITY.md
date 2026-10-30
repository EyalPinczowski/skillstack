# Security policy

Skillstack is an early-stage project handling user accounts and study data.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what you think the impact is. Reports are handled on a best-effort basis as this is a free beta.

## What is in scope

- Access to another user's data (the database enforces row-level security; a bypass is a critical finding).
- Access to the admin console or admin endpoints without the admin role.
- Secrets or personal data exposed in the repository, logs or client code.
- Calendar writes outside the app's own calendar.

## Design notes

- Every user-owned table uses row-level security; the backend never accepts a `user_id` from the client.
- Secrets live only in environment variables and are never committed. CI runs secret scanning.
- No personal details are sent to AI models.
