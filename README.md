# model-alpha-skill

A Solidity contract auditor. Bundles a JavaScript call-graph extractor and a stdlib Python CLI that POSTs each function to a Model Alpha endpoint.

```
┌────────────┐       ┌──────────────────┐       ┌──────────────────────┐
│ Solidity   │       │  CLI + JS tool    │       │  remote Model Alpha  │
│ contract   │──────▶│  (per-function    │──────▶│  audit endpoint      │
│ .sol       │       │   call graph)     │       │                      │
└────────────┘       └──────────────────┘       └──────────────────────┘
```

## What's in this repo

| Path | What it is |
|---|---|
| `scripts/model_alpha_cli.py` | Stdlib Python CLI. Shells out to the JS tool, then POSTs. |
| `scripts/bootstrap.sh` | Installs the CLI to `~/.local/bin/model_alpha_cli`. |
| `solidity-graph/get_function_graph.js` | Call-graph extractor (`@solidity-parser/parser`). |
| `solidity-graph/package.json` | npm manifest. |
| `SKILL.md` | AI-agent operating manual. |

## Install as an AI agent skill (Claude, Codex, Hermes, opencode)

### 1. Clone

```bash
git clone https://github.com/Kann-Audits/model-alpha.git
cd model-alpha
```

### 2. Install to your agent

**Claude** (`~/.claude/skills/`):
```bash
mkdir -p ~/.claude/skills/model-alpha
cp -r ./* ~/.claude/skills/model-alpha/
```

**Codex** (`~/.codex/skills/`):
```bash
mkdir -p ~/.codex/skills/model-alpha
cp -r ./* ~/.codex/skills/model-alpha/
```

**Hermes** (`~/.hermes/skills/`):
```bash
mkdir -p ~/.hermes/skills/model-alpha
cp -r ./* ~/.hermes/skills/model-alpha/
```

**opencode** (`~/.config/opencode/skills/`):
```bash
mkdir -p ~/.config/opencode/skills/model-alpha
cp -r ./* ~/.config/opencode/skills/model-alpha/
```

All at once:
```bash
for AGENT_DIR in ~/.claude/skills ~/.codex/skills ~/.hermes/skills ~/.config/opencode/skills; do
  mkdir -p "$AGENT_DIR/model-alpha"
  cp -r ./* "$AGENT_DIR/model-alpha/"
done
```

Restart your agent so it picks up the new skill. The agent reads `SKILL.md` to learn the operating manual.

### 3. Install dependencies

```bash
cd solidity-graph && npm install && cd ..
```

You're done — no API keys or configuration. The skill connects straight to the hosted portal.

### Pointing an agent directly at this repo

If your agent is configured to pull skills from a git URL, point it at `https://github.com/Kann-Audits/model-alpha.git` — `SKILL.md` lives at the repo root, and the skill name is `model-alpha` (it matches the directory this repo should be installed into).

For agents that only scan a local skills folder, symlink the repo in so updates apply on the next `git pull`:

```bash
git clone https://github.com/Kann-Audits/model-alpha.git ~/model-alpha
mkdir -p ~/.config/opencode/skills            # or ~/.claude/skills, ~/.codex/skills, ~/.hermes/skills
ln -s ~/model-alpha ~/.config/opencode/skills/model-alpha
cd ~/model-alpha/solidity-graph && npm install
git -C ~/model-alpha pull                      # refresh the skill later
```

Requirement: the folder containing `SKILL.md` must be named `model-alpha` so the agent can match it to the skill.

## How the call-graph tool works

The JS tool exports one function:

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

## Integrate with your CLI applications

### 1. Install dependencies

```bash
# Node.js (https://nodejs.org) — required for the call-graph tool.
cd solidity-graph && npm install && cd ..
```

The CLI itself is **stdlib-only** — no `pip install` needed.

### 2. Audit a contract (zero configuration)

```bash
python3 scripts/model_alpha_cli.py audit --contract ./Vault.sol
# or pipe via stdin
cat Vault.sol | python3 scripts/model_alpha_cli.py audit --stdin
```

The CLI connects to the hosted Model Alpha portal out of the box — **no env vars, no API keys, no config**. The endpoint URL is hardcoded in the CLI and cannot be overridden.

Output: one block per function with the assistant's reasoning + verdict. A summary line at the end:

```
SUMMARY: 7 function(s) audited, 3 VULNERABLE, 4 SAFE
```

### 4. Install CLI system-wide

```bash
bash scripts/bootstrap.sh
model_alpha_cli audit --contract ./Vault.sol
```

### 5. Health + limits

```bash
model_alpha_cli health         # GET /health
model_alpha_cli audit-limits   # shows RPM cap, body cap, token caps
```

## Pitfalls

1. **Node.js is required.** The CLI shells out to `node -e` against the bundled `.js`. Without node, the CLI fails fast with a clear error.
2. **The CLI connects to the hosted portal URL, which is hardcoded.** It cannot be reconfigured — the CLI always talks to `https://lyuboslavlyubenov--model-alpha-portal-serve.modal.run`. If the portal is down or returns non-200, run `model_alpha_cli health` to confirm connectivity.
3. **Empty `<fallback>` functions are skipped.** The JS tool may return a function entry with no source for unresolved super-class calls — the CLI drops those silently rather than POSTing an empty `source`.
4. **Per-function calls are deduplicated by `(type, name)`.** The recursive tree may revisit the same callee through multiple paths — first occurrence wins, but recursion continues to surface transitive callees.
5. **Output budget is dictated by the endpoint.** The CLI doesn't enforce `max_tokens` — large contracts may exceed the endpoint's advertised cap and return 413/400.

## License

MIT — see [LICENSE](LICENSE).
