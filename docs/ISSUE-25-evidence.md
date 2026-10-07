# Issue #25 prototype closeout evidence

This record addresses the architecture and prototype scope in [R&D issue #25](https://github.com/DeltaX-Public/deltax-connectome-entity/issues/25). It does not claim public API access, production authorization, or a live Evaluate selection.

## Local validation and selection boundary

- Preflight v2 keeps proposals, policy, and evidence in separate versioned documents. Missing or mistyped facts produce `EVIDENCE_REQUIRED`; multiple proven admissible candidates produce `SELECTION_REQUIRED` without a local choice.
- The [offline demo](../bin/demo-handoff.mjs) starts with `summarize_evidence`, `compare_claims`, and `publish_report`. Local policy rejects `publish_report`, leaving two review steps. The bridge projects only those two into the fixed bounded Evaluate request. A clearly labeled synthetic response selects `summarize_evidence`, and the record retains proposed, admissible, and selected IDs plus both receipt references.
- The projected request and synthetic success response passed the current frozen `2026-09-16.beta2` contract validator offline on 2026-10-06. The validator's local source matched its repository `main` version at the time of the check. This demonstrates wire-shape compatibility only; no credential or hosted endpoint was used.
- The public [developer guide](https://deltaxevaluate.com/developers) documents the bounded request and the restricted hosted access boundary. The downloadable beta1 kit is a historical teaching snapshot, not a beta2 live test.

## GitHub integration

| Evidence | Observed result |
| --- | --- |
| [PR #2](https://github.com/DeltaX-Public/deltax-preflight/pull/2) | Merged the trusted-base workflow, evidence producer, bridge, demo, and tests; CI passed. |
| [PR #3](https://github.com/DeltaX-Public/deltax-preflight/pull/3) and [Preflight run](https://github.com/DeltaX-Public/deltax-preflight/actions/runs/37578101676) | A changed PR proposal context was checked using base-branch code, policy, and reviewed manifest. The Action reported `PASS_SINGLE; 1/2 admissible`. PR merged through branch protection; main CI passed. |
| [PR #4](https://github.com/DeltaX-Public/deltax-preflight/pull/4) and [Preflight run](https://github.com/DeltaX-Public/deltax-preflight/actions/runs/37578282910) | A candidate kept its ID but changed its reviewed payload. The Action reported `EVIDENCE_REQUIRED; 0/2 admissible`. The intentionally failing PR was closed without merging. |

The workflow checks out the PR head as data in `proposal/` and runs the Action, policy, manifest, and evidence producer from the base commit in `trusted/`. It grants `contents: read`, executes no proposed code, and pins the policy hash in the base workflow. GitHub `main` branch protection was read back with required `preflight` and `test` checks, strict up-to-date checks, a PR requirement with zero mandatory approvals, administrator enforcement, and force pushes and deletion disabled. The positive PR merged under these settings.

## Limits and next scope

The manifest comparison is a concrete trust-boundary demonstration, not proof that a candidate is safe in every real-world situation. The evidence source label and hashes do not authenticate external producers. The bridge does not call Evaluate, handle transport or credentials, execute an agent tool, or infer authority from a selection. Those are separate integration and release decisions. The open-source validator remains useful without Evaluate.
