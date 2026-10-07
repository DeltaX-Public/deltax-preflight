# ADR 0002: Separate proposals, policy, and evidence

Status: implemented prototype, 2026-10-06. Supersedes the v1 input and status semantics in [ADR 0001](ADR-0001-preflight-boundary.md).

## Decision

Preflight v2 accepts three separate JSON documents: a **decision proposal** with candidate IDs and payloads, a **policy** with hard constraints, and **evidence** with observed facts. Candidate payloads are never used as proof of admissibility. The API requires all three documents; v1 combined envelopes are rejected. The CLI and GitHub Action require separate file paths. The Action additionally requires a pinned canonical policy hash from its workflow owner.

This separation makes the trust boundary visible. It does not authenticate a file or its producer. The caller must obtain policy and evidence from sources it trusts. In particular, a PR author who can edit the policy, the evidence, and the expected hash can still defeat the check. A production workflow must protect the policy and hash outside untrusted proposal changes and derive evidence from an appropriate authority. The `evidence.source` field is a label, not an attestation.

## Input and status semantics

The three versioned documents have `kind: decision`, `kind: policy`, and `kind: evidence`. The proposal carries no rules or validation facts. Evidence must carry the canonical `decision_hash` of the exact proposal it describes; a mismatch is an input error. Evidence entries refer to proposal candidate IDs; extra IDs are an input error, while missing entries yield unknown checks. Each policy constraint checks a candidate fact or global evidence context using `eq`, `in`, `lte`, `gte`, or `exists`.

Every check is `pass`, `fail`, or `unknown`. Missing facts and wrong fact types are `unknown`, since neither proves that a hard constraint was violated. A candidate with any `fail` is `rejected`; otherwise any `unknown` makes it `unproven`; otherwise it is `admissible`. If **any** candidate is unproven, the result is `EVIDENCE_REQUIRED` and no selection handoff is produced. Once evidence is complete, zero admissible candidates yields `REFUSE`, one yields `PASS_SINGLE`, and multiple yield `SELECTION_REQUIRED`.

This deliberately changes v1 behavior: one admissible candidate plus one unproven candidate no longer returns `PASS_SINGLE`. A missing `exists` fact is now unknown rather than a definitive rejection. Any caller depending on v1 must migrate its decision envelope to the three v2 documents.

## Receipts and handoff

The deterministic receipt hashes the decision, policy, evidence, and result separately with a v2 domain prefix. The hashes establish content identity and replay consistency, not truth, provenance, or execution. The CLI can compute the canonical decision hash for evidence binding and policy hash for workflow pinning. A hash pin can detect policy drift only if the expected hash itself is held in a trusted location.

Only `SELECTION_REQUIRED` produces the local Evaluate handoff. It contains snapshots of the original proposal, policy, evidence, and proven admissible candidate set. It is **not** the hosted Evaluate request format. A future adapter must select only the fields needed by the verified service contract, avoid transmitting unrelated or sensitive evidence, reject a returned candidate outside the admissible set, and keep execution with the caller. Preflight has no network calls, retry behavior, or downstream authority.

## Schema and limits

The `schema/` directory publishes JSON Schema Draft 2020-12 documents for the three inputs. Runtime validation also enforces unique IDs, candidate/evidence linkage, JSON-only values, bounded input size in the CLI/Action, and a maximum nesting depth. The schemas describe structure; runtime checks remain authoritative for cross-document relationships.

## Non-goals

This milestone does not sign evidence, infer its truth, rank admissible candidates, implement Evaluate, create an MCP server, or execute actions. Those require separate designs and explicit authority. A real CI integration should test a protected policy and evidence producer before treating a passing check as an authorization signal.
