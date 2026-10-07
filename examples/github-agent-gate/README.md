# A pull request gate for proposed agent actions

This recipe gives a repository owner a small, useful checkpoint before an agent's proposed next step is accepted. A pull request supplies `.preflight/decision.json` with candidate actions. The workflow compares each exact candidate payload with an owner-reviewed manifest on the base branch, applies the owner's hard rules, and reports the result. It does not execute an action, approve a pull request, or prove that an action is safe in every context.

## Install

From a clone of DeltaX Preflight, with Node.js 20 or later:

```sh
node bin/install-github.mjs /absolute/path/to/your-repo
```

The installer creates these files in the target Git repository and refuses to overwrite any of them:

| File | Who controls it | Purpose |
| --- | --- | --- |
| `.preflight/decision.json` | Pull request author | Proposed actions; treated as data |
| `.preflight/manifest.json` | Repository owner on the base branch | Exact reviewed payloads and facts |
| `.preflight/policy.json` | Repository owner on the base branch | Hard requirements |
| `.github/workflows/preflight.yml` | Repository owner on the base branch | Read-only check with pinned Preflight code and policy hash |

Review the manifest and policy before committing. Commit all four files to the default branch, then open a pull request that changes `.preflight/decision.json`. In GitHub branch protection, require the `preflight` check if it must block merge. Without a required check, this is an advisory signal.

The included rule allows reviewed, local, non-effectful steps. The starter proposal includes `inspect_change`, which passes, and `publish_change`, which is rejected. The expected result is `PASS_SINGLE`. No action runs automatically.

## Try the other outcomes

- Change `inspect_change`'s payload in the proposal while keeping its ID. The base manifest no longer matches; Preflight reports `EVIDENCE_REQUIRED` and the check fails.
- Replace `publish_change` with the exact `compare_evidence` candidate from the manifest. Both candidates are allowed; Preflight reports `SELECTION_REQUIRED` and the check fails until a person narrows the proposal or a separate, authorized selection process resolves it.
- Propose only `publish_change`. It violates the example rule, so Preflight reports `REFUSE` and the check fails.

When adapting this recipe, the owner must decide which candidate shapes and facts the manifest may assert. The manifest is an owner assertion about exact payloads; it is not a general truth source. A pull request's own edits to the manifest, policy, or workflow cannot change the rules used by its current check, because the workflow reads those from the base commit. The `pull_request_target` job gives the GitHub token read-only repository permission, checks out the proposal as data, and runs code only from a pinned Preflight commit. Forked proposals must be accessible to `actions/checkout` for the check to run.

If the owner changes `.preflight/policy.json`, calculate its new canonical hash with `node bin/preflight.mjs --hash-policy /path/to/your-repo/.preflight/policy.json` from the Preflight checkout and update `expected_policy_sha256` in the protected workflow in the same owner-reviewed change. A mismatched hash stops the check.
