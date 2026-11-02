# Start here: a checkpoint for proposed actions

An agent can complete useful work and still propose a next step whose scope, authority, or evidence has changed. DeltaX Preflight helps a workflow pause at that step. It compares **exact proposed options** with **owner-controlled hard rules** and **separately supplied evidence**, then reports what is admissible, rejected, or still unproven.

Preflight does not establish that supplied facts are true, choose between allowed options, approve a person, call a tool, merge a pull request, or perform an action. The surrounding workflow owns those jobs. See [the trust boundary](ADR-0002-trusted-policy-and-evidence.md).

## Pick the problem you have

| Your situation | Where to start |
| --- | --- |
| “I want to see the result before installing anything.” | [Four-scene browser walkthrough](https://deltax-public.github.io/deltax-preflight/). It uses synthetic inputs and precomputed results from the real validator. |
| “I need to learn how to describe my own check.” | [Build your first check](BUILD-YOUR-FIRST-CHECK.md): define the pause point, write decision/policy/evidence, and read the output. |
| “An agent proposes changes in a pull request.” | [Owner-reviewed GitHub gate](../examples/github-agent-gate/README.md). Make its check required if a failing result should block merge. |
| “An agent is about to call a tool.” | [Local MCP server](../mcp/README.md) and the [agent-action fixture](../examples/agent-action.json). Your host still controls trusted inputs and tool execution. |
| “My team makes a different consequential choice.” | Browse [workflow patterns](WORKFLOW-PATTERNS.md), then adapt the same three-document check to your own authority and evidence sources. |

The local CLI, Action, and MCP adapter use the same validator. For a short no-file exercise from a checkout with Node.js 20 or later, run `node bin/try.mjs --example`. The interactive worksheet is self-reported exploration, not an enforcement gate.

## The six-step loop

1. **Name the pause point.** What action could happen next? What changes would make an earlier review stale?
2. **Propose exact options.** The `decision` document names candidate IDs and payloads. Include the parameters that matter to a later review or effect.
3. **State hard rules.** The workflow owner controls the `policy`. Keep preferences and ranking separate from non-negotiable requirements.
4. **Supply facts.** An authorized source produces `evidence` bound to the exact decision hash. A model's own claim about its permission is not independent evidence.
5. **Read the result and stop where needed.** Inspect per-constraint checks and the four [result states](RESULTS-AND-OUTCOMES.md). The surrounding system handles new evidence, selection, approval, and eventual execution.
6. **Observe the later outcome.** Record what actually happened after a separate authorized action. Use recurring gaps and failures to improve the workflow under owner review; the validator does not learn automatically.

## Where Evaluate fits

Preflight is valuable as a local checkpoint even without another service. A `SELECTION_REQUIRED` result means multiple options passed the hard rules; it leaves a choice. A human or separately authorized system can make that choice. The [bounded Evaluate bridge](ADR-0003-evaluate-bridge.md) is an **offline prototype** showing how such a handoff could be minimized and reconciled. It makes no hosted API call and grants no execution authority. Hosted availability, paid access, and any future SDK must be verified and documented separately before use.

Next: [build a check](BUILD-YOUR-FIRST-CHECK.md) or select a [workflow problem](WORKFLOW-PATTERNS.md).
