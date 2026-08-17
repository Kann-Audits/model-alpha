---
name: model-alpha-skill
description: Audit a Solidity smart contract by extracting its call graph with the bundled JS tool and sending each function to a remote Model Alpha endpoint. Use when the user mentions "audit contract", "vulnerability detection", "Solidity review", "model-alpha", or "call graph".
category: security
version: 2.0.0
author: Kann Audits
tags: [security, solidity, vulnerability-detection, call-graph, smart-contracts, ai-agent]
---

# model-alpha-skill

Audit a Solidity contract by:

1. Extracting a per-function call graph with the bundled JS tool (`solidity-graph/get_function_graph.js`).
2. Sending each function (with its callees) to the Model Alpha audit endpoint.
3. Rendering the verdict (`VULNERABLE` / `SAFE`) back in the terminal.

The skill ships the call-graph extractor and a CLI. Set `MODEL_ALPHA_URL` to your own deployment.

## When to trigger

- "audit this contract"
- "is this Solidity safe?"
- "review the function withdraw() in this contract"
- "give me the call graph for Vault.sol"
- "send a Solidity file to model-alpha"

Do **not** trigger for: training, fine-tuning, dataset curation, or model quantization. This skill only audits contracts.

## Files

| File | Purpose |
|---|---|
| `scripts/model_alpha_cli.py` | Stdlib-only CLI. Calls the bundled JS tool via `node -e`, then POSTs to the portal. |
| `scripts/bootstrap.sh` | Installs the CLI to `~/.local/bin/model-alpha`. |
| `solidity-graph/get_function_graph.js` | The call-graph extractor (uses `@solidity-parser/parser`). |
| `solidity-graph/package.json` | npm dependency manifest. Run `npm install` once. |

## Operating manual

### 1. Install dependencies

```bash
# Required: node.js (https://nodejs.org) for the call-graph tool.
# The CLI itself is stdlib-only — no pip install needed.
cd solidity-graph && npm install && cd ..
```

### 2. Set the endpoint

```bash
export MODEL_ALPHA_URL=https://<your-deployment>/<endpoint-name>
# The CLI defaults to a placeholder; you must set this.
```

### 3. Audit a contract

```bash
python3 scripts/model_alpha_cli.py audit --contract ./Vault.sol
# or pipe via stdin
cat Vault.sol | python3 scripts/model_alpha_cli.py audit --stdin
```

Output: one block per function with the assistant's reasoning + verdict. A summary line at the end:

```
SUMMARY: 7 function(s) audited, 3 VULNERABLE, 4 SAFE
```

### 4. Install CLI system-wide

```bash
bash scripts/bootstrap.sh    # installs to ~/.local/bin/model-alpha
model-alpha audit --contract ./Vault.sol
bash scripts/bootstrap.sh --uninstall
```

### 5. Health check

```bash
python3 scripts/model_alpha_cli.py health
# HTTP 200
# {"status": "healthy"}
```

### 6. Inspect limits

```bash
python3 scripts/model_alpha_cli.py audit-limits
# Shows RPM cap, body cap, token caps advertised by the endpoint
```

## How the call-graph tool works

The JS tool (`solidity-graph/get_function_graph.js`) exports one function:

```js
const { analyzeSolidityContract } = require('./get_function_graph.js');
const result = analyzeSolidityContract('/path/to/Contract.sol');
// result.functions = { "functionName": { source, calls, modifiers, parameters, ... }, ... }
```

For each function it returns:
- `source` — the function body as a string
- `calls` — a recursive tree of callees with `type` (`internal`/`external`/`library`), `target`/`method`, `parameters`, and the recursive `calls` array
- `modifiers` — modifier chain applied
- `parameters` — argument list with types
- `constants` — contract-level constants used

The CLI renders this into the per-function audit payload.

## Pitfalls

1. **Node.js is required.** The CLI shells out to `node -e` against the bundled `.js`. If `node` isn't installed, the CLI fails fast with a clear error.
2. **The CLI does NOT ship with a default `MODEL_ALPHA_URL`.** You must point it at your own deployment. The portal you connect to is responsible for authentication, rate limiting, and the upstream model — this skill is the client.
3. **Empty `<fallback>` functions are skipped.** The JS tool may return a function entry with no source (e.g. for unresolved super-class calls). The CLI drops those silently rather than POSTing an empty `source` that the schema will reject.
4. **Per-function calls are deduplicated by `(type, name)`.** The recursive tree may revisit the same callee through multiple paths — first occurrence wins, but recursion continues to surface transitive callees.
5. **The CLI is stdlib-only.** It uses `urllib.request` for HTTP and `subprocess` for node. No pip install on the Python side.
6. **Output budget is dictated by the remote endpoint.** The CLI doesn't enforce `max_tokens` — that's the portal's job. If the endpoint advertises `max_output_tokens=4000`, large contracts may exceed it; split the contract first.
