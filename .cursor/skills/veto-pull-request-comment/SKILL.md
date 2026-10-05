---
name: veto-pull-request-comment
description: >-
  Writes the VETO pull request comment for Agent Gate. Use when changing
  src/comment.js, src/engine.js, the verdict text, examples/comment.md, or
  the comment posted by the GitHub Action.
---

# VETO pull request comment

The comment marker stays `<!-- agent-gate -->`. One comment is created or updated. Do not post a second comment.

## Shape

Lead with who opened the pull request, the verdict, and the risk. Then only the sections that have something to say:

- Production files, what can break, rollback, and the policy edit that revokes an agent
- Secrets: file and secret type. Never paste the secret value
- Dependencies: package, version, advisory id, and the fixed version
- Dangerous code: one impact line, such as "A shell is turned on for a command"

Empty security sections are omitted. The sample production comment in `examples/comment.md` must stay equal to `runScenario("agent-prod").comment`.

## Words

Verdict labels stay Allowed, Needs a named human, and Revoked. The website may say Allowed, Needs a person, and Blocked. Do not invent a fourth verdict.
