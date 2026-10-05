---
name: veto-security-scan
description: >-
  Adds secret, dependency, and dangerous-code checks to VETO. Use when editing
  scanner/rules.json, scanner/scan.py, src/security.js, OSV lookups, SCA, SAST,
  or secret scanning.
---

# VETO security scan

`scanner/rules.json` is the rule list for secrets, code, infrastructure, containers, and the bundled package advisory. `src/security.js` runs it in the browser demo and adds the missing-test note. `scanner/scan.py` runs the same rules on GitHub Actions and adds a public OSV lookup.

Do not add a live application probe or a cloud-account login. See [veto-coverage](../veto-coverage/SKILL.md) for the lanes that stay out of this check.

## Adding a check

1. Add a pattern or advisory to `scanner/rules.json`.
2. Keep the title to the impact. Do not add steps that show someone how to abuse the pattern.
3. Secret findings store the file and the type only. Never store or print the matched value.
4. Cover the new rule with a test in `test/engine.test.js` that asserts the secret string is absent from the comment.

## What this scan is

It reads the pull request diff. It does not scan a running application and it does not read a cloud account. Do not describe it as a replacement for those jobs.
