# DeltaX Preflight

DeltaX Preflight is a local, deterministic validator for proposed actions. It answers **which candidates satisfy explicit hard constraints**. When two or more candidates remain admissible, it reports `SELECTION_REQUIRED` and produces an optional handoff packet for a separate selection process. It does not select a preferred action, call DeltaX, or execute anything.

This is the first prototype for [R&D issue #25](https://github.com/DeltaX-Public/deltax-connectome-entity/issues/25). The [architecture decision record](docs/ADR-0001-preflight-boundary.md) defines its boundary and limits. The code has no runtime dependencies and works without an account or network connection.

## Run

Requires Node.js 20 or later. No installation step is needed:

```sh
node bin/preflight.mjs examples/ci-deploy.json
node bin/preflight.mjs examples/agent-action.json --json
node --test
```

Supply a JSON file or `-` for standard input. `--json` emits `{ "result": ..., "handoff": ... }`. `handoff` is `null` unless the status is `SELECTION_REQUIRED`. Exit codes: `0` for `PASS_SINGLE`, `2` for `SELECTION_REQUIRED`, `3` for `REFUSE`, and `64` for invalid input. A required CI check can therefore stop on unresolved selection or refusal.

The repository also contains a Node 20 GitHub Action. For a workflow using a checked-out decision file, pin it to a reviewed commit:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: DeltaX-Public/deltax-preflight@<reviewed-commit-sha>
    with:
      decision_file: path/to/decision.json
```

The Action emits `status`, `admissible_count`, and `receipt_hash` outputs. It fails the job for `SELECTION_REQUIRED` and `REFUSE`, and it never executes a candidate or sends the envelope to a service. Pin to a reviewed commit when using it across repositories.

## Minimal decision envelope

```json
{
  "schema_version": "1",
  "decision_id": "deploy-123",
  "context": { "environment": "production" },
  "candidates": [
    { "id": "canary", "facts": { "reversible": true, "blast_radius": 1 } },
    { "id": "rollback", "facts": { "reversible": true, "blast_radius": 1 } }
  ],
  "constraints": [
    { "id": "reversible", "source": "candidate", "path": "/reversible", "op": "eq", "value": true },
    { "id": "radius", "source": "candidate", "path": "/blast_radius", "op": "lte", "value": 2 }
  ]
}
```

Each constraint reads a JSON Pointer from `candidate.facts` or `context`. Supported operators are `eq`, `in`, `lte`, `gte`, and `exists`. Every constraint applies to every candidate. IDs use letters, digits, `.`, `_`, `:`, `/`, and `-`, starting with a letter or digit. `exists` rejects a missing fact; other operators mark it `unknown`, so that candidate is withheld as `unproven`. An explicit failed check rejects the candidate even if another check is unknown. No arbitrary expressions or executable policy code are accepted.

The receipt hashes canonical JSON of the input and result with SHA-256. It proves repeatability and content identity, not the truth of supplied facts or the authority to act. Candidate array order is part of the input and hash. No timestamps, network calls, or random choices are involved.

## Status and handoff

| Status | Meaning |
| --- | --- |
| `PASS_SINGLE` | Exactly one candidate is provably admissible under supplied constraints. No action is executed. |
| `REFUSE` | No candidate is provably admissible. Check `rejected` versus `unproven` to distinguish violations from missing evidence. |
| `SELECTION_REQUIRED` | Multiple candidates are provably admissible. Local validation stops without choosing one. |

The handoff packet retains the original envelope, only the admissible candidates, their IDs, and the validation receipt. It is a **local interchange format**, not a claim that the hosted DeltaX API currently accepts this payload. A future adapter must map it to the confirmed API contract, verify the returned candidate is in the admissible set, and leave execution to the calling system.

## Licensing

DeltaX Preflight is licensed under the [Apache License 2.0](LICENSE). This license covers this repository; it does not license the separate DeltaX Evaluate service or its internals. The package remains marked `private` to prevent npm publishing while this is a prototype.
