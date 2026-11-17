# Security

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/fenner888/devin-tui/security/advisories/new).
Do not open a public issue. We reply within 5 business days.

## Baseline

This project follows the [Secure Build Baseline](https://github.com/fenner888/toolbox/tree/main/security-baseline).

| Field | Value |
|---|---|
| Tier | Tier 1 — no user accounts or payments |
| Baseline files added | 2026-11-17 |
| Signed off by | Pending (Mark Fenner) |

## Platforms

GitHub hosts the code and CI. npm supplies dependencies.
The app runs locally and connects to the Devin CLI. Devin handles sign-in.
There is no hosted database, app account system, or payment system.

## AI inventory

Devin (Cognition) runs the user-selected model via the local Devin CLI.
Prompts, attached files, and working-directory context go to Devin to help with coding.
The app does not call model providers directly.
