# DeltaX Preflight

DeltaX Preflight is a local, deterministic validator for proposed actions. It answers **which candidates satisfy explicit hard constraints**. When more than one candidate remains admissible, it reports `SELECTION_REQUIRED` and produces a local handoff packet for a separate selection process. It does not rank candidates, call DeltaX, or execute anything.

For example, if an agent proposes **review**, **compare**, and **publish**, a no-external-effect requirement rules out publishing. Preflight shows the two remaining choices without pretending the rule can decide between them.

This is a public preview of the local Preflight validator built from [R&D issue #25](https://github.com/DeltaX-Public/deltax-connectome-entity/issues/25). [ADR 0002](docs/ADR-0002-trusted-policy-and-evidence.md) defines the local protocol; [ADR 0003](docs/ADR-0003-evaluate-bridge.md) defines the bounded handoff. The [issue evidence](docs/ISSUE-25-evidence.md) records the earlier prototype checks and their limits. The validator has no runtime dependencies and works without an account or network connection.

## Try it without making files

Requires Git and Node.js 20 or later. No account or installation step is needed:

```sh
git clone https://github.com/DeltaX-Public/deltax-preflight.git
cd deltax-preflight
node bin/try.mjs --example
node bin/try.mjs
```

The first command shows an immediate synthetic result. The second asks for your options, hard requirements, and yes/no/unknown facts. It reports which options satisfy those requirements and stops if selection remains open or evidence is missing. This is a **self-reported decision worksheet**, not an independently verified workflow gate. It selects and executes nothing. To save your answers as versioned inputs, run `node bin/try.mjs --save my-check` instead of the second command. Reopen the saved result with `node bin/try.mjs --replay my-check`; your option names remain visible. Verify the facts before using any saved worksheet as an automation input.

The example shows the distinction in a few seconds:

```text
PREFLIGHT (based on synthetic example): SELECTION_REQUIRED
- Review locally: admissible
- Compare evidence: admissible
- Publish now: rejected
More than one option meets the stated requirements. Selection remains open.
```

## Use it in a workflow

For a working GitHub pull request gate, run `node bin/install-github.mjs /path/to/your-repo` from this checkout. It adds one workflow and three example files without overwriting existing files. The workflow checks proposed agent actions against an owner-reviewed list; it uses the base branch for its policy and evidence source, treats the pull request proposal as data, and pins this checkout's Preflight commit and policy hash. Review the files and commit them to your repository's default branch before opening a proposal pull request. [The complete recipe](examples/github-agent-gate/README.md) explains the results and how to require the check before merge. The check does not run any proposed action.

The [independent example repository](https://github.com/DeltaX-Public/deltax-preflight-example) ran this recipe on GitHub: [one allowed action passed and merged](https://github.com/DeltaX-Public/deltax-preflight-example/pull/1), while [a changed payload stopped for evidence](https://github.com/DeltaX-Public/deltax-preflight-example/pull/2) and [two allowed actions stopped for selection](https://github.com/DeltaX-Public/deltax-preflight-example/pull/3). Its main branch requires the `preflight` check.

For an automated check, policy must come from the workflow owner and facts from a source authorized to assert them. If you need file templates, run:

```sh
node bin/init.mjs my-check
```

This creates `decision.json`, `policy.json`, `evidence.json`, and a short guide in `my-check/`. The first run deliberately returns `EVIDENCE_REQUIRED`: you must replace the empty facts with evidence from a source you trust. You can start from those valid files without learning the JSON structure first. You still need to decide which rules apply and who can assert the facts.

In plain terms: the **decision** lists options, the **policy** states requirements, and the **evidence** contains checked facts about each option. Keep policy and evidence under the control of people or systems authorized to provide them.

The full examples run without setup:

```sh
node bin/preflight.mjs examples/ci-deploy.json \
  --policy examples/ci-policy.json \
  --evidence examples/ci-evidence.json
node bin/preflight.mjs --hash-policy examples/ci-policy.json
node bin/preflight.mjs --hash-decision examples/ci-deploy.json
node --test
node bin/demo-handoff.mjs
```

The first example intentionally exits with code `2`: two valid options remain, so selection is still needed. That is a successful demonstration of the decision boundary, though a shell configured to stop on nonzero exits will pause there.

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

## Bounded Evaluate bridge

The optional [bridge](src/evaluate-bridge.mjs) turns a verified `SELECTION_REQUIRED` handoff into the fixed bounded-review request described in the [DeltaX developer guide](https://deltaxevaluate.com/developers). It sends only proven admissible candidates with explicitly supplied objective and scalar context; it does not copy the full proposal, policy, or evidence into the request. The bridge accepts at most eight review candidates and refuses external candidates as selectable options. A success response must match the `2026-09-16.beta2` shape, preserve all false authority and effect flags, and select only an admissible candidate or return `governed_noop_refusal`.

`node bin/demo-handoff.mjs` runs a **synthetic offline demonstration**: three options enter Preflight, two survive, and a synthetic contract-valid response selects one review step. It records both receipts and the proposed, admissible, and selected IDs. This demo makes no API call and supplies no credential. Hosted access remains restricted; use an assigned client and its transport checks for any separately authorized live call. The bridge does not rank candidates or grant action authority.

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

The [proposal integration workflow](.github/workflows/proposal-preflight.yml) demonstrates that boundary for this repository. It runs trusted action code, policy, and a reviewed candidate manifest from the pull request's base commit. It checks out the proposed decision separately as **data only**. The trusted evidence producer compares each candidate's exact payload with the manifest and leaves changed or unknown options unproven. The workflow has read-only repository permission and does not execute proposed code. Its policy hash is pinned in the base workflow. GitHub `main` branch protection requires a PR and passing `preflight` and `test` checks, including for administrators; see the [positive and negative run evidence](docs/ISSUE-25-evidence.md).

## Migration from v1

The first prototype put `constraints` and candidate `facts` in one decision envelope. Version 2 intentionally rejects that shape. Move `constraints` into a policy file, facts into an evidence file, and keep only proposal payloads in the decision file. `EVIDENCE_REQUIRED` is a new status, and a missing `exists` fact is now unknown. No v1 compatibility path is enabled in the default CLI or Action.

## License

DeltaX Preflight is licensed under the [Apache License 2.0](LICENSE). This license covers this repository; it does not license the separate DeltaX Evaluate service or its internals. The package remains marked `private` because this preview is distributed through GitHub rather than npm.
