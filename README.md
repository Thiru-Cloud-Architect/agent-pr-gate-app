# Agent Gate

Agent Gate is a review desk for pull requests opened by coding agents. It has two parts:

- A **GitHub Action** that posts one comment on each pull request.
- A **one-page website** that runs the same review on sample pull requests, so you can try a policy before wiring the action into a repo.

## Who it is for

Platform and DevOps engineers who review agent-opened pull requests and need one comment that says whether that actor may touch production.

## What the comment contains

The comment is deterministic. It names:

- **Who** opened the change: a human, a listed agent, or an unlisted bot.
- **Prod paths** in the diff, with service, namespace, environment, and risk.
- **What can break**, such as a database class or replica-count change.
- **Rollback**: revert the pull request, and do not apply Terraform or Helm from the agent branch.
- **Revoke**: the policy edit that closes that path for the agent.
- **Risk**: low, medium, or high.

By default the check only comments. Set `fail-on-risk: high` when a high-risk review should fail the job.

## Cost

It costs nothing beyond the repository’s GitHub Actions minutes. No AWS account and no model key are required. An optional secret, `BLAST_RADIUS_API_KEY`, adds a short plain-language summary from an OpenAI-compatible chat endpoint. If the key is missing, or the model call fails, the deterministic comment still posts.

## Run the website locally

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run dev
```

Open <http://127.0.0.1:43123>. Switch the sample pull requests and edit the file list. `npm test` needs no secrets. `npm run comment` prints the production-agent comment. `npm run build` writes `site/dist` for GitHub Pages.

## Install the action on another repo

This action is meant to be used from `Thiru-Cloud-Architect/agent-pr-gate-app`. After that repository is on GitHub, tag `v1`, then add this step:

<!-- install-snippet:start -->
```yaml
- uses: Thiru-Cloud-Architect/agent-pr-gate-app@v1
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
      - uses: Thiru-Cloud-Architect/agent-pr-gate-app@v1
        with:
          fail-on-risk: never
```

Copy [examples/policy.yaml](examples/policy.yaml) to `.agent-gate/policy.yaml` and edit the paths for your repo. A sample comment is in [examples/comment.md](examples/comment.md).

`api-key` reads the secret `BLAST_RADIUS_API_KEY`. Leave it unset and no model is called. With a key, the action sends the deterministic comment to an OpenAI-compatible endpoint and appends a short summary. The default model is `gpt-4o-mini` when `model` is empty. Set `BLAST_RADIUS_BASE_URL` on the step to point at a different endpoint.

The action reads the pull request diff and posts one comment. It asks for `contents: read` and `pull-requests: write` only.

## Verdicts

| Verdict | Meaning |
| --- | --- |
| Allowed | A human, or a listed agent staying inside its allow list. Risk is still shown. |
| Needs a named human | A listed agent touched a production path outside its allow list, or an unlisted bot touched a medium or high path. |
| Revoked | The actor is on an agent deny list and touched a matching path. |

High risk fails the job only when `fail-on-risk` is `high`.

When a Terraform file changes and the pull request has no plan JSON, or Helm values change with no rendered manifests, the comment adds an “Ask a human” note. Those filenames are not enough to claim a full plan.

## GitHub Pages

`.github/workflows/pages.yml` builds the same review desk as `npm run dev`. In the repository settings, set Pages to deploy from GitHub Actions.
