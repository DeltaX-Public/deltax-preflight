# Build your first Preflight check

Start with a **workflow boundary**, not a JSON file. For this synthetic example, an agent preparing a report can propose `read_report`, `edit_report`, or `send_report`. The host pauses before invoking any tool. The workflow owner requires every option to be within scope and authorized for the current context. A separate evidence source supplies those facts. The host controls any later choice, approval, and tool call.

Before adapting this example, write down five things for your own workflow:

| Question | Report example |
| --- | --- |
| What exact action might happen next? | Read, edit, or send a report. |
| Who proposes the options? | The agent. |
| Who controls the hard rules and can assert the facts? | The workflow owner controls policy; its authorized evidence producer supplies facts. |
| What could change before the action? | Task scope, report, recipient, or permission. |
| Who chooses and executes after validation? | The host and its separately authorized reviewer or executor. |

## Run a complete synthetic example

Clone this repository, use Node.js 20 or later, and run from its root:

```sh
node bin/preflight.mjs examples/agent-action.json \
  --policy examples/agent-policy.json \
  --evidence examples/agent-evidence.json \
  --json
```

The command intentionally exits `2` with `SELECTION_REQUIRED`. `read_report` and `edit_report` are admissible; `send_report` fails the `authorization` constraint. The host must still choose among the first two and authorize any later effect. This example does not read, edit, or send a real report.

Open the three inputs side by side: [decision](../examples/agent-action.json), [policy](../examples/agent-policy.json), and [evidence](../examples/agent-evidence.json). Their roles are different:

| Document | What you write | What it cannot prove |
| --- | --- | --- |
| `decision.json` | `decision_id`, shared task `context`, and candidate IDs with exact action `payload`s. Include consequential parameters such as resource, destination, scope, and amount where relevant. | A proposal cannot certify its own permission or facts. |
| `policy.json` | Owner-controlled `constraints`: an ID, `source` (`candidate` or `context`), JSON Pointer `path` into evidence, operator, and expected value when applicable. | A policy edited by the same actor as the proposal is not an independent boundary. |
| `evidence.json` | Facts for each candidate and shared context, a producer label, and the canonical `decision_hash` of the exact proposal checked. | The `source` label and hashes do not authenticate the producer or prove the facts true. |

The report fixture uses two simple Boolean rules. Its policy checks `/within_scope` and `/authorized_for_current_context` in each candidate's **evidence facts**. `send_report` has `authorized_for_current_context: false`. The candidate payload does not supply that fact. For your own rules, the supported operators are `eq`, `in`, `lte`, `gte`, and `exists`. Keep soft preferences out of this hard-rule check. See the [v2 policy schema](../schema/policy.v2.schema.json) and [trust design](ADR-0002-trusted-policy-and-evidence.md).

## Create and edit your own starter

```sh
node bin/init.mjs my-check
node bin/preflight.mjs my-check/decision.json \
  --policy my-check/policy.json \
  --evidence my-check/evidence.json \
  --json
```

The generated files are valid, but the first check intentionally returns `EVIDENCE_REQUIRED`: the evidence facts are empty. Replace the example candidates with one bounded decision from your workflow. Keep the policy under its owner, then obtain facts from a source authorized to assert them. If a fact is unavailable, leave it missing; do not guess `true` or convert unknown to `false`.

After **any** decision edit, have the evidence producer bind its facts to the new canonical proposal hash:

```sh
node bin/preflight.mjs --hash-decision my-check/decision.json
```

Update `evidence.decision_hash` to that exact output. A changed candidate payload with the old hash is an input error, even if its ID stayed the same. In a GitHub gate, pin the policy hash in owner-controlled workflow code; a PR that can edit both policy and expected hash cannot protect itself. The [owner-reviewed gate recipe](../examples/github-agent-gate/README.md) shows that arrangement.

## Read the result, then decide what happens next

Find `result.status`, each `candidate.verdict`, and each `check.constraint_id` with its `pass`, `fail`, or `unknown` outcome. [The result guide](RESULTS-AND-OUTCOMES.md) maps those signals to the next workflow step. A receipt hashes decision, policy, evidence, and result content; it is a replay/change-detection aid, not approval or a record that an effect happened.

Try one change at a time in a copy of the fixture:

1. Remove `authorized_for_current_context` from `edit_report`'s facts. It becomes `unknown`; the overall result is `EVIDENCE_REQUIRED` until an authorized source supplies the fact.
2. Change a candidate payload while retaining its ID. The old `decision_hash` no longer matches. Recheck the new proposal and regenerate its evidence binding; do not transfer old approval.
3. Propose one reviewed, admissible option and one definitively rejected option. With no unknown checks, expect `PASS_SINGLE`. The host still owns any effect.

Store observation time, real evidence provenance, freshness rule, and later action outcome in the surrounding workflow's audit record; the v2 documents do not have extra top-level fields for these. See [results and outcomes](RESULTS-AND-OUTCOMES.md) for a memory pattern. The local CLI, Action, and MCP adapter do not execute candidates.
