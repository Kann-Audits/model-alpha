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

- **Large batches are handled automatically.** Every function’s complete reasoning and verdict is printed; if a function cannot be processed, the full endpoint error is printed. On a 429, the CLI waits 61 seconds, retries the same safe request, and continues the contract. Use `--rate-limit-wait SECONDS` to override the delay.
- Very large individual functions may still hit the portal's token cap; their complete error response is shown.

## License

MIT — see [LICENSE](LICENSE).