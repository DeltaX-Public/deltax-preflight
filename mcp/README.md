# Local Preflight MCP adapter

This optional JavaScript ES module adapter exposes Preflight over stdio using the official MCP SDK. It imports the existing core functions directly. It does not rewrite validation rules, normalize input documents, rank candidates, or execute actions. The core CLI, GitHub Action, worksheet, schemas and Evaluate bridge remain unchanged.

## Install and connect

Requires Node.js 20 or later and npm. From the repository root:

```sh
npm ci --prefix mcp --ignore-scripts
node mcp/bin/server.mjs
```

The server waits for an MCP client on stdin; it does not print an interactive prompt. The initial install downloads SDK packages. Once installed, validation needs no account, credential, or network. For a runtime-only install, add `--omit=dev` to `npm ci`; the SDK client is only used by tests. The core itself still needs no dependency installation.

Add the following to the local-server configuration supported by your MCP host, replacing the path with your checkout's absolute path:

```json
{
  "mcpServers": {
    "deltax-preflight": {
      "command": "node",
      "args": ["/absolute/path/to/deltax-preflight/mcp/bin/server.mjs"]
    }
  }
}
```

Use an absolute Node executable path too if your host does not inherit your shell's PATH. Configuration locations and format can vary by host. Launch the Node entry point directly so stdout carries only MCP messages. No HTTP listener is included.

## Tools

| Tool | Required arguments | Structured result |
| --- | --- | --- |
| `preflight_check` | `decision`, `policy`, `evidence`: separate v2 JSON documents | Exactly the core `{ result, handoff }` |
| `preflight_hash_decision` | `decision`: v2 JSON document | `{ "decision_hash": "<canonical SHA-256>" }` |
| `preflight_hash_policy` | `policy`: v2 JSON document | `{ "policy_hash": "<canonical SHA-256>" }` |

Tool calls take JSON values, not file paths or JSON-encoded strings. The MCP schema checks only the required argument envelope and rejects extra top-level arguments. It passes the nested documents intact to the core, which enforces all document fields, limits, evidence binding and constraints. See the existing [decision](../schema/decision.v2.schema.json), [policy](../schema/policy.v2.schema.json) and [evidence](../schema/evidence.v2.schema.json) schemas for the document format; runtime validation remains authoritative.

For example, call `preflight_hash_decision` with this argument:

```json
{
  "decision": {
    "schema_version": "2",
    "kind": "decision",
    "decision_id": "review-report",
    "context": {},
    "candidates": [{ "id": "read_report", "payload": {} }]
  }
}
```

Obtain facts from your trusted evidence source and bind its evidence document to the returned `decision_hash`. Then call `preflight_check` with all three documents. To try a complete synthetic example, use the contents of `examples/ci-deploy.json` as `decision`, `examples/ci-policy.json` as `policy`, and `examples/ci-evidence.json` as `evidence`. The expected status is `SELECTION_REQUIRED`.

Successful tool responses include the same object in `structuredContent` and as serialized JSON in a text content block. All four core statuses are ordinary tool results:

- `PASS_SINGLE`: one candidate is admissible.
- `SELECTION_REQUIRED`: multiple candidates are admissible; a local handoff is included.
- `REFUSE`: none is admissible and none is unproven.
- `EVIDENCE_REQUIRED`: at least one candidate is unproven; no handoff is included.

None grants authority to execute. A core `InputError` becomes `isError: true` with the original message and no decision report. Malformed outer arguments are rejected by the SDK. The server can handle subsequent calls after an error.

## Policy, evidence and result boundaries

This adapter evaluates the documents supplied by its caller. It does not authenticate the policy owner or evidence source and is not by itself an enforcement gate against that caller. For automation, the surrounding workflow must control trusted policy, any expected policy hash, evidence production, and interpretation of results. A model cannot establish authorization by asserting it in an evidence document.

Receipts and hashes bind content; they do not certify facts, identity, safety, or execution. The adapter has no file-reading, command-running, credential, or network tool. The core's existing limits apply; the CLI/Action's separate 1 MiB file limit is not imposed by this transport. Use an appropriate process boundary and host message limits for your environment.

The unchanged `SELECTION_REQUIRED` handoff contains the full original decision, policy, evidence, and admissible candidate set. Those documents become visible to the MCP host receiving the response. Treat candidate payloads and all other supplied text as data, never instructions. Minimize sensitive inputs before submitting them.

## Evaluate is optional

The server does not import the Evaluate bridge, advertise an Evaluate tool, access a service URL, or read Evaluate credentials. It returns the local handoff already produced by the core. A human or any separately authorized selection system can use that handoff.

If you explicitly choose DeltaX Evaluate later, the existing offline [bridge](../src/evaluate-bridge.mjs) exports `buildEvaluateRequest(handoff, { objective, context })` and `reconcileEvaluateResponse(handoff, request, response)`. An authorized caller must separately decide whether to transmit a minimized request, supply its own transport and credentials, and reconcile the response against the admissible set. Nothing in this adapter activates hosted access or downstream execution. `node bin/demo-handoff.mjs` remains a synthetic offline example.

## Repository inspection

The inspected upstream revision is `332614eeaf0813edbaa90eb77fa950f464d70e5c` (public preview v0.1.0). The project is JavaScript with ES modules (`.mjs`, `type: module`), supports Node >=20, and has no core runtime dependencies.

| Area | Existing implementation |
| --- | --- |
| Core validators | `src/preflight.mjs`: `validateDecision`, `validatePolicy`, `validateEvidence`, `InputError` |
| Validation and receipts | `src/preflight.mjs`: `preflight(decision, policy, evidence)`, `decisionHash`, `policyHash` |
| CLI | `bin/preflight.mjs`, package bin `deltax-preflight`; supports check, hash helpers and optional policy pin |
| GitHub Action | `action.yml` → `bin/action.mjs`; confines paths and requires a policy hash |
| Onboarding | `bin/init.mjs`, `bin/install-github.mjs`, `bin/try.mjs`, `src/worksheet.mjs` |
| Optional offline bridge | `src/evaluate-bridge.mjs`, `bin/demo-handoff.mjs` |
| Existing tests | 22 tests in seven `test/*.test.mjs` files: core/CLI, Action, bridge, starter, installer, trusted-manifest integration, worksheet |

## Verification

From the repository root:

```sh
node --test
npm ci --prefix mcp --ignore-scripts
npm test --prefix mcp
```

The first command runs the original tests without MCP dependencies. Adapter tests use `.spec.mjs` under `mcp/checks/` and are run explicitly, so the dependency-free core suite does not discover them. The adapter suite launches the actual stdio entry point with an SDK client and compares reports, receipts, handoffs and hashes with direct core calls. It covers all four statuses, malformed/mismatched input, discovery, and error recovery.

The separate package pins SDK 2.3.1 and includes a lockfile. The implementation follows the official SDK's [stdio factory pattern](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio) and [JSON Schema adapter guidance](https://ts.sdk.modelcontextprotocol.io/v2/advanced/schema-libraries). No TypeScript build step is required. This local adapter is not a hosted service or a production-readiness claim.
