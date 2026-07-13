# Security Policy

Tab handles typing-adjacent context, authentication, device tokens, billing, and Personal Memory. Please report security and privacy issues carefully.

## What To Report

Report issues such as:

- Unauthorized access to accounts, devices, memories, billing state, or API data.
- Leaks of Typing Context, Personal Memory, secrets, credentials, tokens, prompts, or generated text.
- Device-token storage, rotation, revocation, or auth-handoff weaknesses.
- Redaction bypasses that could transmit obvious secrets.
- Telemetry or logging that stores user-authored text unexpectedly.
- Cloudflare Worker, D1, billing webhook, or desktop permission vulnerabilities.

## How To Report

Use GitHub private vulnerability reporting if it is available for this repository:

https://github.com/crafter-station/tab/security/advisories/new

If private reporting is unavailable, open a minimal public issue titled `Security contact request` and do not include exploit details, secrets, personal data, or private logs.

## Please Include

- A concise description of the issue.
- Impact and affected surfaces.
- Reproduction steps or proof of concept using synthetic data only.
- Relevant versions, commit SHA, macOS version, browser, or deployment environment.
- Any logs with secrets, tokens, prompts, completions, and user-authored text removed.

## Supported Versions

Security fixes target the `main` branch and the latest public release artifacts. Older local builds may not receive separate patches.

## Safe Harbor

Good-faith security research is welcome when it avoids privacy harm, data destruction, persistence, service disruption, and access to data that is not yours. Stop testing and report promptly if you encounter sensitive data.
