---
name: veto-merge-gate
description: >-
  Makes the VETO GitHub check fail on critical findings so branch protection
  can block merge. Use when changing fail-on-risk, shouldFail, action.yml, or
  the check line in the pull request comment.
---

# VETO merge gate

`fail-on-risk` defaults to `critical`.

`shouldFail` returns true when the mode is `critical` or `high` and any of these are true:

- verdict is revoked
- risk is high
- a high secret, dependency, code, container, or infrastructure finding exists

`never` only comments. Do not change that exception.

The comment must say the job fails, and that GitHub blocks the merge only when branch protection requires this check. Failing the job alone does not block merge.
