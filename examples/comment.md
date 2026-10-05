<!-- agent-gate -->
## KORV

| | |
| --- | --- |
| Verdict | Revoked |
| Risk | High |
| Who | `cursor[bot]` · agent `cursor` |

This agent is denied on a production path in this pull request. Do not let the agent merge it.

### Prod surface

| File | Change | Service | Namespace | Environment | Risk |
| --- | --- | --- | --- | --- | --- |
| `infra/prod/rds.tf` | modified | payments | payments | production | high |
| `charts/payments/values.yaml` | modified | payments | payments | production | high |

### What can break

- payments in production: database class changes from `db.t4g.micro` to `db.m6g.large` (`infra/prod/rds.tf`).
- payments in production: replica count changes from 2 to 8 (`charts/payments/values.yaml`).

### Rollback

- Revert this pull request. Do not merge the agent commit and redeploy from this branch.
- Do not run `terraform apply` from this branch. Generate the next plan from `main` after the revert.
- Redeploy the previous Helm values from `main`. Do not run `helm upgrade` or `helm install` from this branch.

### Revoke

`cursor` is already denied for `infra/prod/**`, which matches `infra/prod/rds.tf`. These other production files are not in the deny list: `charts/payments/values.yaml`. Add them, then this agent cannot open the same door again.

```yaml
    - name: cursor
      actors:
        - cursor[bot]
      deny:
        - infra/prod/**
        - charts/payments/**
```

### Ask a human

- Terraform files changed and this pull request has no plan JSON. Resource names are inferred from the diff only.
- Helm or manifest files changed and this pull request has no rendered manifests.

### Evidence

- `infra/prod/rds.tf` modified, matched `infra/prod/**` (high), agent `cursor` deny
- `charts/payments/values.yaml` modified, matched `charts/payments/**` (high), outside the agent allow list
- `docs/runbook.md` modified, matched no production path, inside the agent allow list

No model was called. To add a plain-language summary, set repository secret `BLAST_RADIUS_API_KEY` and pass `api-key: ${{ secrets.BLAST_RADIUS_API_KEY }}`. The deterministic review still posts when the key is missing.

Check: comment only. Set `fail-on-risk: critical` when a critical finding should fail the job and block merge.
