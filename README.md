# Agent Gate

Agent Gate is a GitHub Action for platform engineers. On each pull request it posts one comment: who opened the change, which production paths it touches, what can break, how to roll it back, and the policy edit that revokes that agent.

It runs on the repository’s GitHub Actions minutes. It does not need an AWS account, a domain, or a paid model. A model key is optional. If the key is missing, the deterministic comment still posts, and the check does not fail for that reason.

The check is a comment unless you set `fail-on-risk: high`.

## Install

Publish this repository, tag `v1`, and replace `OWNER` with your GitHub username.

<!-- install-snippet:start -->
```yaml
- uses: OWNER/agent-gate@v1
  with:
    fail-on-risk: never
    policy-path: .agent-gate/policy.yaml
    api-key: ${{ secrets.BLAST_RADIUS_API_KEY }}
    model: ${{ vars.BLAST_RADIUS_MODEL }}
```
<!-- install-snippet:end -->

The workflow around that step:

```yaml
name: Agent Gate
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: OWNER/agent-gate@v1
        with:
          fail-on-risk: never
```

Copy [examples/policy.yaml](examples/policy.yaml) to `.agent-gate/policy.yaml` and edit the paths for your repo. A screenshot-ready comment is in [examples/comment.md](examples/comment.md).

`api-key` reads the secret `BLAST_RADIUS_API_KEY`. Leave it unset and no model is called. With a key, the action sends the deterministic comment to an OpenAI-compatible chat endpoint and appends a short summary. Override the endpoint with the `BLAST_RADIUS_BASE_URL` environment variable if you add it to the step yourself. The default model is `gpt-4o-mini` when `model` is empty.

The action does not run `terraform apply`, `helm install`, or `kubectl`. It does not clone submodules. It asks for `contents: read` and `pull-requests: write` only.

## Try it locally

```bash
npm install
npm test
npm run comment
npm run dev
```

`npm test` runs without secrets. `npm run dev` serves the website at <http://127.0.0.1:43123>, where you can switch sample pull requests and edit the file list. `npm run build` writes `site/dist` for GitHub Pages.

## GitHub Pages

This repo includes `.github/workflows/pages.yml`. In the repository settings, set Pages to deploy from GitHub Actions. The site is the same review desk as `npm run dev`.

## What the comment decides

| Situation | Verdict |
| --- | --- |
| Actor is on an agent deny list and touched that path | Revoked |
| Agent touched a production path outside its allow list, or an unlisted bot touched a medium or high path | Needs a named human |
| Human, or an agent inside its allow list | Allowed |

Risk still shows for an allowed change. High risk fails the job only when `fail-on-risk` is `high`.

When a Terraform file changes and the pull request has no plan JSON, or Helm values change with no rendered manifests, the comment adds an “Ask a human” note. Those filenames are not enough to claim a full plan.
