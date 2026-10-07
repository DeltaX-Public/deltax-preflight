name: Preflight proposed agent actions
on:
  pull_request_target:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout trusted base
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          path: trusted
          persist-credentials: false
      - name: Checkout proposal as data
        uses: actions/checkout@v4
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.sha }}
          path: proposal
          persist-credentials: false
      - name: Checkout reviewed Preflight version
        uses: actions/checkout@v4
        with:
          repository: DeltaX-Public/deltax-preflight
          ref: __PREFLIGHT_COMMIT__
          path: preflight-tool
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Derive evidence from the base branch manifest
        run: node preflight-tool/integration/derive-evidence.mjs proposal/.preflight/decision.json trusted/.preflight/manifest.json evidence.json
      - name: Stop proposals that need evidence or selection
        uses: ./preflight-tool
        with:
          decision_file: proposal/.preflight/decision.json
          policy_file: trusted/.preflight/policy.json
          evidence_file: evidence.json
          expected_policy_sha256: __POLICY_HASH__
