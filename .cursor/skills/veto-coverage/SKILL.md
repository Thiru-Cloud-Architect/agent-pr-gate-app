---
name: veto-coverage
description: >-
  States which security lanes KORV actually scans. Use when the user mentions
  SCA, SAST, DAST, code coverage, IaC, container scanning, Dependabot, Snyk,
  StackHawk, Prisma, Orca, or Wiz.
---

# KORV coverage

The pull request check reads the diff. Say what is implemented. Do not claim the other lanes.

| Lane | In the check |
| --- | --- |
| Secrets | Yes. File and type only. |
| SCA | Yes. Dependency versions in the diff, plus the OSV lookup from `scanner/scan.py`. |
| SAST | Yes. The patterns in `scanner/rules.json` under `code`. |
| Infrastructure | Yes. Open network rules, public storage, privileged containers. |
| Containers | Yes. `latest` tags and `USER root` in files. Not a built image. |
| Tests | Yes. A missing test file in the diff. Not a coverage percentage. |
| DAST | No. A running application is not opened. |
| Cloud account | No. Prisma, Orca, and Wiz need a cloud login. |
| Dependabot | No. KORV does not open Dependabot pull requests. It can still flag a version Dependabot would flag. |

Critical findings fail the job when `fail-on-risk` is `critical` or `high`. Merge is blocked only when branch protection requires the check.
