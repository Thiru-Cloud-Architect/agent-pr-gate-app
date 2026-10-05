---
name: veto-website
description: >-
  Updates the KORV website so a new reader can see the GitHub comment and the
  green check. Use when editing site/index.html, site/main.js, site/style.css,
  or site/media screenshots.
---

# KORV website

The page is static. GitHub Pages cannot run the Python scanner. The try-it box uses `src/engine.js` in the browser. The Python scanner runs only in the GitHub Action.

## What the first screen must show

1. The product name KORV, the portfolio, the fix pull request, and the merge check.
2. A screenshot of a real pull request comment, with a caption that translates Verdict, Risk, and Who into plain language.
3. A screenshot of the green GitHub Actions check, with a caption that says the job posted the comment.
4. The try-it examples, including the secret and old-package example.
5. A link to `site/org.html`, the sample account dashboard.
6. A coverage table that names the lanes in the check and the two lanes that are not: a running application, and a cloud account.

Captions state what the picture shows. Do not leave the reader to decode the GitHub comment alone.

Replace screenshots by capturing the real pull request. Do not draw a fake GitHub comment.
