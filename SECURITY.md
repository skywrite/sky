---
created: 2026-08-05
updated: 2026-08-05
---

# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Sky, please report it privately — **do not open a public issue**.

- **Email:** [jprichardson@gmail.com](mailto:jprichardson@gmail.com)
- **GitHub:** use [private vulnerability reporting](https://github.com/skywrite/sky/security/advisories/new) on this repository

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a proof of concept helps a lot)
- The affected version or commit
- Any suggested fix, if you have one

## What to Expect

- An acknowledgment of your report, typically within a few days
- Updates as the issue is investigated and fixed
- Credit in the release notes for the fix, unless you prefer to remain anonymous

Please give us a reasonable amount of time to address the issue before any public disclosure.

## Supported Versions

Only the latest release (and the `main` branch) receives security fixes.

## Scope

Sky is a local-first CLI and service that operates on a personal notebook on your own machine. Reports of particular interest include:

- Leakage of notebook contents or credentials outside the local machine
- Command or code injection via notebook content, file names, or AI-generated queries
- Vulnerabilities in the local service's HTTP/GraphQL/WebSocket endpoints
- Insecure handling of secrets (tokens, API keys, keychain access)

Vulnerabilities in third-party dependencies should be reported upstream, but feel free to let us know if Sky's usage of a dependency makes it exploitable.
