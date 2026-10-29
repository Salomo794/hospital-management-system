# Security Policy

## Reporting a vulnerability

Please do not disclose security vulnerabilities in public issues, discussions, or pull requests.

Use GitHub's private vulnerability reporting feature for this repository if it is enabled. If private reporting is unavailable, contact the repository maintainer privately through a verified GitHub contact channel and include steps to reproduce the issue. Avoid including real patient information, credentials, tokens, or other sensitive data in reports.

## Deployment security

- Set a unique, high-entropy `JWT_SECRET` in each environment; never commit secrets.
- Do not use demo seed data or demo credentials in production. Keep `ALLOW_DEMO_SEED` unset/false in production.
- Configure `BACKUP_ENCRYPTION_KEY` securely and store it separately from backups and application configuration.
- Restrict database and backup access, use HTTPS, and regularly test backup restoration.
- Keep Node.js and dependencies updated and review dependency/security alerts.
- Never test against real patient data unless explicitly authorized and appropriate safeguards are in place.
