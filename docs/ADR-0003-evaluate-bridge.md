# ADR 0003: Bounded Evaluate handoff and integration proof

Status: implemented offline prototype, 2026-10-06.

## Evaluate boundary

Preflight remains the local authority on admissibility. The optional bridge re-runs validation from the handoff snapshots, verifies its receipt and admissible set, and projects only admissible bounded-review candidates into the fixed Evaluate profile. The caller supplies the bounded objective and scalar context explicitly. Proposal payloads provide only `semantic_class`, `description`, and `operator_reported_support`; no policy or evidence document is automatically transmitted.

The request projector follows the fixed `POST /v1/evaluations` bounded-review shape documented by [DeltaX Evaluate](https://deltaxevaluate.com/developers). It rejects unsupported IDs, external candidates, more than eight admissible candidates, invalid support values, secret-bearing text, and unsupported context fields. The response reconciler accepts only the `2026-09-16.beta2` success envelope, checks its trace, receipt, false effect and authority flags, and requires a selected ID from the admissible set or a null ID on governed refusal. It makes no network call, retries, or candidate execution. HTTP status, authentication, idempotency, and transport errors belong to an independently authorized client.

The synthetic example and tests were checked against the current frozen beta2 contract validator on 2026-10-06. This is offline contract compatibility evidence, not hosted evaluation or public API availability. The public developer kit is a historical beta1 teaching snapshot; a live client must use its assigned runtime version and credentials.

## GitHub trust boundary

The `pull_request_target` workflow reads its action code, policy, evidence producer, and reviewed manifest from the base commit. It reads the proposal from the PR head as JSON data and grants the workflow only repository read permission. Unknown or changed candidate payloads produce unknown facts, which stop the Action with `EVIDENCE_REQUIRED`. The pinned policy hash detects accidental or unauthorized policy drift within the trusted workflow. A PR author cannot change that base workflow, policy, manifest, or producer in the current check by editing the head branch.

This demonstration does not prove the manifest's real-world claims or protect against a principal who can directly change the default branch. Branch protection and maintainer review are repository controls outside the validator. The check is a local validation signal, never permission to publish or perform another effect.

## Evidence record

The end-to-end demo records the original proposed IDs, local per-candidate verdicts, Preflight receipt, bounded Evaluate request, selected or refused outcome, trace ID, and Evaluate receipt reference. Its response is synthetic and explicitly labeled as such. It shows the difference between local validation and downstream selection without claiming that the hosted service chose the option.
