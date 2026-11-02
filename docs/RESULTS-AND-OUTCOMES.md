# From a Preflight result to the next decision

The status is a checkpoint in a larger workflow. Read the candidate-level `verdict` and each `check.constraint_id` with its `pass`, `fail`, or `unknown` outcome. Then route the result to the actor who owns the next step. The validator does not approve, choose, execute, or observe the later effect.

| Status | Meaning | Surrounding workflow's next step |
| --- | --- | --- |
| `PASS_SINGLE` (CLI exit `0`) | Exactly one candidate is proven admissible; all others are rejected. | Present the exact admissible option to the separate approval or execution gate. Recheck facts that may have changed before the effect. |
| `EVIDENCE_REQUIRED` (exit `4`) | At least one candidate remains unproven because a check is missing or has an invalid type. Even if another candidate passes, selection remains blocked. | Ask the authorized evidence producer for the specific missing fact, or revise the proposal. Do not guess a value or treat `unknown` as `false`. |
| `SELECTION_REQUIRED` (exit `2`) | Multiple candidates are proven admissible; the hard rules do not choose among them. | Give the admissible set and objective to a human or separately authorized selector. Record the choice and its basis; keep effect approval and execution separate. |
| `REFUSE` (exit `3`) | No candidate is admissible and none is unproven. | Stop this proposal. Redesign it or request a separately reviewed owner policy change; do not fabricate evidence. |

Malformed input, an evidence decision-hash mismatch, unknown candidate evidence, or a policy-hash mismatch is an **input error** (CLI exit `64`), not one of the four result statuses. Fix the input and revalidate before considering an effect. The [README](../README.md#result-states) documents the status and exit-code contract.

## What the receipt means

The result includes hashes of the decision, policy, evidence and result. They identify the exact content checked and help detect drift or replay a comparison. They do not prove a fact is true, authenticate the evidence producer, authorize an action, or show that an action happened. The `evidence.source` string is also a label, not authentication. The workflow must establish provenance and trust outside Preflight. A changed candidate payload needs a new decision hash and evidence for that exact proposal, even when its ID is unchanged.

Only `SELECTION_REQUIRED` produces the local Evaluate handoff. That handoff includes the original input documents; inspect and minimize them before transmitting information to another system. The optional [bounded Evaluate bridge](ADR-0003-evaluate-bridge.md) is an offline prototype and does not make a hosted request. A future live API client or SDK should reconcile its returned selection with the admissible set, preserve refusal and error states, and leave execution with the caller.

## A proposed outcome-memory pattern

**This is an integration design, not built-in Preflight memory or automatic learning.** Keep three records separate:

1. **Validation record:** task/workflow ID; timestamp; candidate IDs; decision, policy, evidence and result hashes; status; per-constraint checks; evidence source and observation time. Keep only the information needed to investigate or revalidate. Do not store secrets in an educational example.
2. **Selection/effect record:** who or what selected an admissible option; any approval; exact action identity; when the external system attempted it; its native receipt or explicit unknown outcome. A `PASS_SINGLE` receipt is never a substitute for this record.
3. **Outcome record:** what was later observed, when, against which task objective; whether it contradicted the earlier evidence or policy assumptions; and the correction or follow-up. Keep the observed outcome distinct from an agent's self-report.

Task memory can retain current owner, permission, repository head, policy version, open evidence gap, and expiry/recheck trigger. Refresh that memory whenever a consequential state changes. A periodic human review can count recurring missing facts, mistaken refusals, and actions that passed validation but failed later. That review may improve the evidence producer, add a test, change a workflow, or propose an owner-reviewed policy revision. It should never automatically relax hard rules because an agent was blocked often.

### Example: reviewed local scope becomes public

The [four-scene walkthrough](https://deltax-public.github.io/deltax-preflight/) shows a synthetic `inspect_change` proposal whose ID stays the same while its payload changes from local to public. The previous reviewed manifest no longer covers it, so the derived facts are unknown and Preflight returns `EVIDENCE_REQUIRED`. The task record should say **prior local evidence stale; new public-scope evidence required**. If a later, separately authorized public effect occurs, store its effect receipt and actual outcome as new records. Do not rewrite the old validation into a success event.

## When to hand off to Evaluate

An unresolved, bounded choice among proven admissible options is one possible reason to request Evaluate review. It is not needed for every Preflight call. The current bridge [documents its offline boundary](ADR-0003-evaluate-bridge.md); hosted access and any paid route have their own release, contract, identity, billing and error semantics. Do not advertise a live call or SDK based on the offline bridge. When an API and SDK are released, a separate guide should show the verified request/response shape, failure and retry behavior, receipt linkage, and an end-to-end example with no implied authority to execute.
