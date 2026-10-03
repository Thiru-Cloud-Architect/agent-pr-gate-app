import { evaluate } from "./engine.js"
import { samplePolicyText } from "./samplePolicy.js"

const rdsPatch = `@@ -12,3 +12,3 @@ resource "aws_db_instance" "payments" {
-  instance_class = "db.t4g.micro"
+  instance_class = "db.m6g.large"
`

const valuesPatch = `@@ -1,3 +1,3 @@
-replicaCount: 2
+replicaCount: 8
`

const deployPatch = `@@ -1,6 +1,6 @@
 apiVersion: apps/v1
 kind: Deployment
 metadata:
-  name: payments-api
+  name: payments-api
   namespace: prod
`

export const scenarios = [
  {
    id: "agent-prod",
    label: "Agent edits production",
    detail: "cursor[bot] resizes the payments database and raises the replica count.",
    input: {
      actor: "cursor[bot]",
      actorType: "Bot",
      policyText: samplePolicyText,
      files: [
        { filename: "infra/prod/rds.tf", status: "modified", patch: rdsPatch },
        { filename: "charts/payments/values.yaml", status: "modified", patch: valuesPatch },
        { filename: "docs/runbook.md", status: "modified", patch: "" },
      ],
    },
  },
  {
    id: "human-docs",
    label: "Human edits the runbook",
    detail: "A person changes docs only. The comment stays low risk.",
    input: {
      actor: "thirumalai",
      actorType: "User",
      policyText: samplePolicyText,
      files: [{ filename: "docs/runbook.md", status: "modified", patch: "" }],
    },
  },
  {
    id: "dependabot",
    label: "Dependabot lockfile",
    detail: "A listed agent stays inside its allow list.",
    input: {
      actor: "dependabot[bot]",
      actorType: "Bot",
      policyText: samplePolicyText,
      files: [
        { filename: "package.json", status: "modified", patch: "" },
        { filename: "package-lock.json", status: "modified", patch: "" },
      ],
    },
  },
  {
    id: "unknown-bot",
    label: "Unlisted bot touches prod",
    detail: "A new agent is not on the roster and edits a production manifest.",
    input: {
      actor: "nightly-release[bot]",
      actorType: "Bot",
      policyText: samplePolicyText,
      files: [{ filename: "infra/prod/web.yaml", status: "modified", patch: deployPatch }],
    },
  },
]

export function runScenario(id) {
  const scenario = scenarios.find((item) => item.id === id)
  if (!scenario) throw new Error(`Unknown scenario ${id}`)
  return evaluate(scenario.input)
}

export function previewPullRequest({ actor, actorType, filesText, policyText }) {
  const files = String(filesText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((filename) => ({ filename, status: "modified", patch: "" }))
  return evaluate({
    actor: actor || "unknown",
    actorType: actorType || "User",
    policyText: policyText || samplePolicyText,
    files,
  })
}
