export const samplePolicyText = `version: 1
paths:
  - path: infra/prod/**
    service: payments
    namespace: payments
    environment: production
    risk: high
  - path: charts/payments/**
    service: payments
    namespace: payments
    environment: production
    risk: high
  - path: "**/*.tf"
    service: terraform
    environment: inferred
    risk: medium
  - path: "**/values.yaml"
    service: helm
    environment: inferred
    risk: medium
  - path: "**/templates/**"
    service: helm
    environment: inferred
    risk: medium
agents:
  - name: cursor
    actors:
      - cursor[bot]
    allow:
      - docs/**
      - "**/*.md"
    deny:
      - infra/prod/**
  - name: dependabot
    actors:
      - dependabot[bot]
    allow:
      - package.json
      - package-lock.json
      - npm-shrinkwrap.json
`
