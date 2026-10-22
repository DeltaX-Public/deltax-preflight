# An agent changed a reviewed proposal

[Try the live demo on GitHub Pages](https://deltax-public.github.io/deltax-preflight/). It opens in your browser with no download, account or API key. GitHub Pages serves the static files; all walkthrough interactions happen in your browser.

For offline viewing, open [index.html](index.html) from a downloaded or cloned copy of this repository. Keep `index.html`, `styles.css`, `app.js`, and `fixtures.js` together. A downloaded copy needs no network connection. The [poster](poster.svg) provides a static preview for the repository.

The four scenes show what happens when an agent proposes a reviewed local inspection, changes its payload while retaining its ID, offers two reviewed local options, or proposes publication alone. Inputs are synthetic; all displayed validation results and receipts come from the real validator. This page displays precomputed results rather than running arbitrary proposals in the browser.

The visual design was created by the user's Grok Bot Visual Desk, then integrated and verified against Preflight's existing fixtures. No core validation behavior changes for this demo.

The [Pages workflow](../../.github/workflows/publish-demo.yml) verifies the generated results and publishes only the five static demo files from `main`. It runs when the demo or its deployment workflow changes and can also be dispatched manually from `main`.

## Verify the results

From the repository root, with Node.js 20 or later:

```sh
node docs/demo/generate-fixtures.mjs --check
```

The generator calls the existing [trusted-manifest evidence producer](../../integration/derive-evidence.mjs), then the unchanged [core validator](../../src/preflight.mjs), for every scene. It reads the existing [example proposal, policy and manifest](../../examples/github-agent-gate/), asserts the four expected statuses, and compares the generated file with `fixtures.js`. CI runs this check so changes to those sources cannot silently leave the demo results stale.

To regenerate after an intentional source change:

```sh
node docs/demo/generate-fixtures.mjs
```

## Use the same check in your workflow

- [GitHub Action on Marketplace](https://github.com/marketplace/actions/deltax-preflight)
- [Owner-reviewed pull request gate recipe](../../examples/github-agent-gate/README.md)
- [Local MCP server and bundle](../../mcp/README.md)

Policy and evidence need an authorized owner and source. This example compares exact payloads with a reviewed manifest; it does not establish that asserted facts are true. A passing result grants no authority and executes nothing. Multiple admissible options still require a separate choice. A GitHub merge is blocked only when the repository owner requires the check. The MCP server evaluates the caller's supplied documents; the surrounding application controls enforcement. DeltaX Evaluate remains optional.
