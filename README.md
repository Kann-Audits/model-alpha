# model-alpha

Audit Solidity contracts for vulnerabilities using AI. Install it as a skill, then ask your agent to audit any contract — zero configuration, no API keys, nothing to set up.

## Install (one command)

```bash
git clone https://github.com/Kann-Audits/model-alpha.git /tmp/model-alpha
```

Copy it into your agent's skills folder — it must live in a directory named `model-alpha`:

| Agent | Install |
|---|---|
| **opencode** | `mkdir -p ~/.config/opencode/skills && cp -r /tmp/model-alpha ~/.config/opencode/skills/model-alpha` |
| **Claude** | `mkdir -p ~/.claude/skills && cp -r /tmp/model-alpha ~/.claude/skills/model-alpha` |
| **Codex** | `mkdir -p ~/.codex/skills && cp -r /tmp/model-alpha ~/.codex/skills/model-alpha` |
| **Hermes** | `mkdir -p ~/.hermes/skills && cp -r /tmp/model-alpha ~/.hermes/skills/model-alpha` |

One-time dependency (Node.js, for call-graph extraction):

```bash
cd ~/.config/opencode/skills/model-alpha/solidity-graph && npm install
```

Restart your agent. Done.

## Use

Ask your agent, e.g. *"audit this contract"* or *"is this Solidity safe?"* pointing at a `.sol` file. It extracts each function's call graph and sends it to the hosted Model Alpha portal, returning a `VULNERABLE` / `SAFE` verdict per function.

## Notes

- **No setup, ever.** The portal URL is hardcoded and cannot be changed — the skill never asks for one.
- Requires **Node.js** and **Python 3**.
- Very large contracts may hit the portal's token cap; split the file first.

## License

MIT — see [LICENSE](LICENSE).