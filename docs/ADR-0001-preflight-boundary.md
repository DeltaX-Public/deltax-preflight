# ADR 0001: Local validation and selection boundary

Status: proposed prototype, 2026-10-06. Related: [DeltaX R&D issue #25](https://github.com/DeltaX-Public/deltax-connectome-entity/issues/25).

## Decision

Preflight validates candidate actions against explicit hard constraints supplied in a versioned decision envelope. It never infers preferences, ranks candidates, or performs downstream actions. A separate evaluator or human can select from a surviving set when local rules leave multiple admissible candidates.

The envelope has `schema_version`, `decision_id`, `context`, `candidates[]` with `id` and `facts`, and `constraints[]` with `id`, `source`, JSON Pointer `path`, `op`, and (except `exists`) `value`. Context can carry objective, evidence references, and other decision state; the generic validator reads only fields named by constraints. Candidate and constraint IDs must be unique. The schema is deliberately small and domain neutral.

## State machine

1. Parse and validate the envelope. Malformed input is an input error, not a decision result.
2. For each candidate, run every constraint. Each check is `pass`, `fail`, or `unknown`.
3. A candidate with any `fail` is `rejected`; otherwise one with any `unknown` is `unproven`; otherwise it is `admissible`.
4. Zero admissible candidates gives `REFUSE`; one gives `PASS_SINGLE`; two or more gives `SELECTION_REQUIRED`.

`unproven` means evidence required by a rule is missing. It is withheld from the admissible set. `REFUSE` must be read with its verdict counts: zero survivors may mean violated constraints, incomplete evidence, or both. Explicit contradiction between a candidate fact and a hard rule is a failed check. Contradictions among supplied evidence sources are not silently resolved; a producer must encode the relevant conflict as facts and constraints or withhold the candidate for review. Preflight does not claim epistemic certainty beyond supplied data.

## Handoff

Only `SELECTION_REQUIRED` emits a handoff packet. It includes the original decision envelope, exact admissible candidate objects and IDs, and hashes of the validated input/result. The receiver must keep the admissible set fixed, map to a verified Evaluate contract, and reject any returned selection outside it. The packet is not itself an API request, permission grant, or execution command. Human selection remains available with no DeltaX dependency.

## Determinism and trace

The trace records each rule outcome and reason. SHA-256 receipts use canonical object-key ordering, preserve array ordering, and carry a domain/version prefix. They detect changed inputs/results; they do not authenticate who supplied facts, whether evidence is true, or whether an action happened. No telemetry leaves the machine. Aggregate measures such as rejected count or agent proposal versus final human selection require a separate, consented recording design.

## Examples

- **CI/CD:** A release workflow submits `deploy_now`, `deploy_canary`, and `rollback` with facts about reversibility and blast radius. The local check rejects violating options. If canary and rollback survive, the check exits 2 and requires a human or external evaluator to decide. See `examples/ci-deploy.json`.
- **Agent/MCP:** An agent submits `read_report`, `edit_report`, and `send_report` with scope and authorization facts derived by its caller. Local constraints reject unauthorized sending. If reading and editing remain, the agent gets `SELECTION_REQUIRED` without automatic tool execution. See `examples/agent-action.json`.

## Non-goals and follow-up

This prototype does not include a hosted API call, an MCP server, policy scripting, candidate scoring, automatic action execution, claims about DeltaX's internal algorithm, or production readiness. The GitHub Action is only a thin wrapper over the local validator. Next steps are a formal JSON Schema, fixture-based integration tests, and an explicit adapter against the verified Evaluate request/response contract.
