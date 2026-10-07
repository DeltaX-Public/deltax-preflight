# DeltaX Preflight v0.1.0 — conference public preview

DeltaX Preflight is a local decision checkpoint. It tests proposed actions against owner-supplied hard rules and evidence, then reports whether one action is admissible, none are, facts are missing, or several admissible actions still require selection. It selects and executes nothing.

## Start in minutes

Clone the [public repository](https://github.com/DeltaX-Public/deltax-preflight) with Git and run `node bin/try.mjs --example` with Node.js 20 or later. Run `node bin/try.mjs` for a guided worksheet without creating files. The worksheet uses your own answers; it is a demonstration and planning aid, not independently verified evidence.

For a pull request automation, run `node bin/install-github.mjs /path/to/your-repo` from the Preflight checkout. Review the generated policy and manifest before committing. The installed workflow checks an exact owner-reviewed menu of proposed agent actions and can be required by branch protection. [Setup and outcomes](../examples/github-agent-gate/README.md).

## Verification

- The public repository's Node test suite passes, including the installer, saved worksheet replay, validator, action, and bounded offline handoff.
- The [independent example repository](https://github.com/DeltaX-Public/deltax-preflight-example) installed the gate and required the `preflight` check on its main branch.
- Its [positive pull request](https://github.com/DeltaX-Public/deltax-preflight-example/pull/1) produced `PASS_SINGLE` and merged; a [changed payload](https://github.com/DeltaX-Public/deltax-preflight-example/pull/2) produced `EVIDENCE_REQUIRED`; [two valid actions](https://github.com/DeltaX-Public/deltax-preflight-example/pull/3) produced `SELECTION_REQUIRED`. The two failing pull requests were closed without merging.

## Scope

The GitHub recipe proves only that proposals match the owner's reviewed manifest and rules. The owner must control the base branch policy and choose which facts its manifest may assert. Preflight does not authenticate arbitrary external evidence or grant action authority. The optional Evaluate bridge has only been verified offline against a fixed contract; this release makes no hosted Evaluate availability claim. The package is distributed through GitHub and is not published to npm.
