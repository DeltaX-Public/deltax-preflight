# DeltaX Preflight

DeltaX Preflight is a local, deterministic validator for proposed actions. It answers **which candidates satisfy explicit hard constraints**. When more than one candidate remains admissible, it reports `SELECTION_REQUIRED` and produces a local handoff packet for a separate selection process. It does not rank candidates, call DeltaX, or execute anything.

This is a prototype for [R&D issue #25](https://github.com/DeltaX-Public/deltax-connectome-entity/issues/25). [ADR 0002](docs/ADR-0002-trusted-policy-and-evidence.md) defines the current protocol and trust boundary. The validator has no runtime dependencies and works without an account or network connection.

## Run locally

Requires Node.js 20 or later. No installation step is needed:

```sh
node bin/preflight.mjs examples/ci-deploy.json \
  --policy examples/ci-policy.json \
  --evidence examples/ci-evidence.json
node bin/preflight.mjs --hash-policy examples/ci-policy.json
node bin/preflight.mjs --hash-decision examples/ci-deploy.json
node --test
```

The decision path may be `-` for standard input. Use `--json` to emit `{ "result": ..., "handoff": ... }`. For a pinned policy, add `--expect-policy-sha256 <hash>`. Each input is limited to 1 MiB by the CLI and Action.

The [decision](schema/decision.v2.schema.json), [policy](schema/policy.v2.schema.json), and [evidence](schema/evidence.v2.schema.json) files have separate JSON Schemas. The examples include a [CI deployment proposal](examples/ci-deploy.json) and an [agent action proposal](examples/agent-action.json), each with matching policy and evidence files. Candidate IDs and payloads express what is proposed. Only evidence facts are checked against policy.

## Trust boundary

Keep policy under the workflow owner's control, separate from the actor proposing candidates. Obtain evidence from a source authorized to assert the relevant facts. The evidence producer must set `decision_hash` to the canonical hash of the exact proposal it checked; `--hash-decision` computes that value. A changed proposal is rejected even when candidate IDs stay the same. The `evidence.source` string identifies that source for records but does **not** authenticate it. Preflight cannot establish that supplied facts are true. Its receipt hashes the decision, policy, evidence, and result separately; hashes detect changed content but do not grant authority to act.

The GitHub Action requires `expected_policy_sha256`. Calculate it with `--hash-policy` and pin it in a protected workflow. A policy file from a pull request checkout is not independently trusted merely because its hash matches a value the same pull request can change. The Action also needs a trustworthy evidence producer. It does not upload the envelope or use network credentials.

## Result states

| Status | Meaning | Exit code |
| --- | --- | ---: |
| `PASS_SINGLE` | Exactly one candidate is proven admissible; all others are rejected. Nothing is executed. | 0 |
| `SELECTION_REQUIRED` | Multiple candidates are proven admissible. Local validation stops without choosing one. | 2 |
| `REFUSE` | No candidate is admissible, and none is unproven. | 3 |
| `EVIDENCE_REQUIRED` | At least one candidate is unproven because evidence is missing or has the wrong type. No handoff is produced. | 4 |

Malformed input, unrecognized candidate evidence, or a policy hash mismatch exits `64`. Each candidate includes per-constraint `pass`, `fail`, or `unknown` checks. A definitive failure rejects a candidate; otherwise an unknown check makes it unproven. Supported operators are `eq`, `in`, `lte`, `gte`, and `exists` over JSON Pointers into candidate or context evidence.

Only `SELECTION_REQUIRED` emits the local Evaluate handoff. It contains the original proposal, policy, evidence, admissible set, and receipt. **It is not a hosted API request.** Inspect and minimize it before any later network transmission. An Evaluate adapter must use the verified service contract, refuse selections outside the admissible set, and never execute a candidate on Preflight's behalf.

## GitHub Action

The Node 20 Action runs the same local validator. A workflow can use a reviewed commit and a policy hash pinned outside untrusted proposal changes:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: DeltaX-Public/deltax-preflight@<reviewed-commit-sha>
    with:
      decision_file: path/to/decision.json
      policy_file: path/to/protected-policy.json
      evidence_file: path/to/trusted-evidence.json
      expected_policy_sha256: <hash-from---hash-policy>
```

The Action outputs `status`, `admissible_count`, `receipt_hash`, and `policy_hash`. It fails the job for unresolved selection, refusal, or missing evidence. The example paths only illustrate the interface: the calling workflow must actually protect its policy and evidence sources.

## Migration from v1

The first prototype put `constraints` and candidate `facts` in one decision envelope. Version 2 intentionally rejects that shape. Move `constraints` into a policy file, facts into an evidence file, and keep only proposal payloads in the decision file. `EVIDENCE_REQUIRED` is a new status, and a missing `exists` fact is now unknown. No v1 compatibility path is enabled in the default CLI or Action.

## License

DeltaX Preflight is licensed under the [Apache License 2.0](LICENSE). This license covers this repository; it does not license the separate DeltaX Evaluate service or its internals. The package remains marked `private` to prevent npm publishing while this is a prototype.
