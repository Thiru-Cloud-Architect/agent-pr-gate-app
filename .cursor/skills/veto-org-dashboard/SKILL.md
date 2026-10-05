---
name: veto-org-dashboard
description: >-
  Builds the KORV organization dashboard from repository files. Use when
  editing site/org.html, site/org.js, site/data/org.json, or scanner/org_scan.py,
  or when asked for a company, team, or org view of findings.
---

# KORV organization dashboard

`scanner/org_scan.py` reads repositories for the signed-in GitHub user and writes `site/data/org.json`. `site/org.html` renders that file.

The dashboard is a sample for one account, not a hosted multi-tenant app. Do not add accounts, passwords, or a new backend service.

Each repository shows findings and practice notes. A finding with `pullRequest` shows an Open fix pull request button. The button opens that repository. It does not merge. The page also lists the two lanes that are not scanned: a running app, and a cloud account.

Do not put secret values, tokens, or file contents in `org.json`.
