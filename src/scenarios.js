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

const fakeGitHubToken = ["ghp", "a".repeat(36)].join("_")

const secretPatch = `@@ -0,0 +1,2 @@
+const token = "${fakeGitHubToken}"
+subprocess.run(cmd, shell=True)
`

const packagePatch = `@@ -1,3 +1,4 @@
 {
   "dependencies": {
+    "lodash": "4.17.20"
   }
 }
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
    label: "Agent changes the database",
    detail: "cursor[bot] resizes the payments database and raises how many copies are running.",
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
    label: "A person edits docs",
    detail: "A person changes the runbook only. No production files move.",
    input: {
      actor: "thirumalai",
      actorType: "User",
      policyText: samplePolicyText,
      files: [{ filename: "docs/runbook.md", status: "modified", patch: "" }],
    },
  },
  {
    id: "dependabot",
    label: "Dependabot updates packages",
    detail: "Dependabot only edits package files, which it is allowed to change.",
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
    id: "secret-and-package",
    label: "Secret and an old package",
    detail: "The pull request adds a GitHub token, turns a shell on, and pins an old lodash.",
    input: {
      actor: "cursor[bot]",
      actorType: "Bot",
      policyText: samplePolicyText,
      files: [
        { filename: "src/config.js", status: "added", patch: secretPatch },
        { filename: "package.json", status: "modified", patch: packagePatch },
      ],
    },
  },
  {
    id: "unknown-bot",
    label: "Unknown bot changes production",
    detail: "A bot you have not listed edits a production file.",
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
