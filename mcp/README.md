# Local Preflight MCP adapter

**Check the exact action your agent proposes against explicit rules and evidence.** For example, a reviewed local inspection can become unproven when its payload changes, even if its action ID stays the same. [See the four-result walkthrough](../README.md#when-a-reviewed-action-changes).

This optional JavaScript ES module adapter exposes Preflight over stdio using the official MCP SDK. It imports the existing core functions directly. It does not rewrite validation rules, normalize input documents, rank candidates, or execute actions. The core CLI, GitHub Action, worksheet, schemas and Evaluate bridge remain unchanged.

## Install and connect

For an MCPB-compatible desktop client, [download the published v0.1.0 bundle](https://github.com/DeltaX-Public/deltax-preflight/releases/tag/mcp-v0.1.0) and install it through the client's local extension controls. Review the release and its checksum before installation. The bundle runs locally and requires Node.js 20 or later. It has no hosted endpoint or API key. The source setup below works with hosts that support local stdio servers.

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

## Local MCPB distribution

The [bundle manifest](bundle/manifest.json) packages the local stdio server for MCPB-compatible desktop clients. It requires Node.js 20 or later and no account credentials, user configuration or Evaluate service. The bundle contains the unchanged core validator, existing MCP entry points and only the installed runtime packages selected by `mcp/package-lock.json`. It preserves the core import paths; the separate optional Evaluate bridge is not included.

Install the pinned official [MCPB tooling](https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md) in a separate work directory. Set these paths to absolute locations outside the repository; the builder refuses existing staging directories or output files and never installs dependencies or publishes anything:

```sh
# Run from the repository root. Choose an existing writable parent outside it.
BUNDLE_WORK=/absolute/path/to/work/preflight-mcpb
mkdir -p "$BUNDLE_WORK"
npm install --prefix "$BUNDLE_WORK/tools" --cache "$BUNDLE_WORK/npm-cache" \
  --ignore-scripts --no-audit --no-fund @anthropic-ai/mcpb@2.1.2
npm ci --prefix mcp --cache "$BUNDLE_WORK/npm-cache" --ignore-scripts

node mcp/bundle/build.mjs \
  --stage "$BUNDLE_WORK/stage-0.1.0" \
  --output "$BUNDLE_WORK/deltax-preflight-mcp-0.1.0.mcpb" \
  --mcpb-cli "$BUNDLE_WORK/tools/node_modules/@anthropic-ai/mcpb/dist/cli/cli.js"

# Includes official manifest validation and packing, then extracts a fresh archive
# outside the checkout and calls the actual server using the SDK client.
MCPB_CLI="$BUNDLE_WORK/tools/node_modules/@anthropic-ai/mcpb/dist/cli/cli.js" \
  node --test mcp/checks/bundle.spec.mjs
```

The builder reports the artifact path, SHA-256 hash, tool version and proposed release tag `mcp-v0.1.0`. The dedicated MCP tag leaves the existing core preview tag separate. Keep the staged directory for inspection; choose a fresh stage/output path for subsequent builds. The build has repeatable locked inputs but does not claim byte-for-byte identical ZIP archives across environments.

For distribution, attach the tested `.mcpb` artifact to a GitHub Release. The [official MCP Registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx) accepts a GitHub/GitLab Release artifact URL with `registryType: "mcpb"`, `fileSha256` and stdio transport; namespace authentication is a separate publishing step. [Smithery](https://smithery.ai/docs/build/publish) also accepts a prebuilt local MCPB bundle. Building the artifact does not create either marketplace listing.

The [registry metadata](server.json) names `io.github.DeltaX-Public/deltax-preflight` and pins the exact release artifact hash. The manual [registry publication workflow](../.github/workflows/publish-mcp-registry.yml) runs only from this repository's `main` branch: it verifies the release asset and the pinned official publisher before using GitHub OIDC. It requires no saved registry secret. Publish the matching release asset before dispatching it; a repository merge alone does not submit a listing. Track native submission and acceptance evidence in [the marketplace rollout issue](https://github.com/DeltaX-Public/deltax-preflight/issues/9).

## Container distribution

The root [Dockerfile](../Dockerfile) builds only the core validator, MCP adapter and locked production dependencies. It runs as the unprivileged `node` user and speaks stdio with no HTTP port or Evaluate service:

```sh
docker build --tag deltax-preflight-mcp .
docker run --rm -i --network=none deltax-preflight-mcp
```

Configure a Docker-capable MCP host with command `docker` and args `["run", "--rm", "-i", "--network=none", "deltax-preflight-mcp"]`. The initial image build downloads the base image and dependencies; the runtime check needs no network. CI builds the image and compares an actual container response against the core report with networking disabled. [Glama maintainer metadata](../glama.json) identifies the repository's verified GitHub maintainer; it does not claim a directory quality score or listing acceptance.
