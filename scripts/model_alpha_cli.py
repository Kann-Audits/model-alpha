#!/usr/bin/env python3
"""
model_alpha_cli.py — User-facing CLI for auditing Solidity contracts via the
Model Alpha endpoint.

Reads a .sol file (or stdin), extracts a per-function call graph using the
bundled JS tool (solidity-graph/get_function_graph.js), and POSTs each function
to the Model Alpha portal.

Setup:
  cd solidity-graph && npm install   # one-time, for the call-graph tool

The endpoint URL is hardcoded and cannot be overridden — the CLI always
connects to the hosted Model Alpha portal.

Commands:
  health                              GET /health
  models                              GET /v1/models (OpenAI-compat)
  audit --contract PATH.sol            POST audit (per-function, call-graph context)
  audit --stdin                        Read contract from stdin
  audit-functions --contract PATH.sol  Convenience alias for `audit`
  audit-limits                         GET /v1/audit-anon/limits — show RPM + caps

Examples:
  # Audit a contract
  python3 model_alpha_cli.py audit --contract ./contracts/Vault.sol

  # Pipe contract from stdin
  cat Vault.sol | python3 model_alpha_cli.py audit --stdin

  # See current limits
  python3 model_alpha_cli.py audit-limits
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


# Hardcoded endpoint: the hosted Model Alpha portal. The URL is intentionally
# fixed — the CLI always connects to this server and cannot be reconfigured.
DEFAULT_URL = "https://lyuboslavlyubenov--model-alpha-portal-serve.modal.run"


def get_url() -> str:
    return DEFAULT_URL


def request(
    method: str,
    path: str,
    *,
    body: Optional[dict] = None,
    timeout: int = 300,
) -> tuple[int, dict | bytes]:
    """Returns (status_code, parsed_json_or_bytes_if_not_json). No auth.
    5-minute timeout so long audit runs on the portal don't time out."""
    url = get_url() + path
    headers = {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body_bytes = resp.read()
            try:
                return resp.status, json.loads(body_bytes)
            except json.JSONDecodeError:
                return resp.status, body_bytes
    except urllib.error.HTTPError as e:
        body_bytes = e.read()
        try:
            return e.code, json.loads(body_bytes)
        except json.JSONDecodeError:
            return e.code, body_bytes


def print_result(status: int, body) -> None:
    if isinstance(body, dict):
        print(json.dumps(body, indent=2, default=str))
    elif isinstance(body, bytes):
        print(body.decode(errors="replace"))
    else:
        print(body)
    if status >= 400:
        sys.exit(1)


# ── Subcommands ────────────────────────────────────────────────────────────


def cmd_health(args):
    status, body = request("GET", "/health")
    print(f"HTTP {status}")
    print_result(status, body)


def cmd_models(args):
    status, body = request("GET", "/v1/models")
    print(f"HTTP {status}")
    print_result(status, body)


def cmd_audit_anon_limits(args):
    """Show the limits advertised by the endpoint."""
    status, body = request("GET", "/v1/audit-anon/limits")
    print(f"HTTP {status}")
    print_result(status, body)


def _render_callees_sft(calls_tree):
    """Render the JS extractor's nested call-graph dicts into SFT-format strings.

    The training format uses:
        ### Callee: <type> <name>(<params>)
        ```solidity
        <full source of callee>
        ```

    Walks the recursive `calls` tree, de-duplicates by `target`/`method`
    (first occurrence wins), and emits one formatted block per unique callee.
    """
    seen = set()
    out = []

    def walk(items):
        for item in items or []:
            ctype = item.get("type") or "internal"
            name = item.get("target") or item.get("method") or ""
            params = item.get("parameters", [])
            if not name:
                continue

            if ctype == "external":
                instance = item.get("instance") or ""
                ctype_str = item.get("contractType") or "External"
                header = f"### Callee: external {instance}.{name}({', '.join(params)})"
            elif ctype == "library":
                lib = item.get("library") or ""
                header = f"### Callee: library {lib}.{name}({', '.join(params)})"
            else:
                header = f"### Callee: {ctype} {name}({', '.join(params)})"

            key = (ctype, name)
            if key in seen:
                walk(item.get("calls"))
                continue
            seen.add(key)

            source = item.get("source", "").strip()
            if source:
                block = f"{header}\n```solidity\n{source}\n```"
            else:
                block = header
            out.append(block)
            walk(item.get("calls"))

    walk(calls_tree)
    return out


def _payload_size_warning(payload: dict, fname: str, byte_cap: int = 8192, token_cap: int = 4000) -> None:
    """Warn (do not fail) when a payload is at risk of rejection by the endpoint.

    Two caps typically apply:
    - 8KB body cap on the `source` field (returns 413)
    - ~4K input-token cap on the rendered prompt (returns 400 "context length exceeded")

    Surface oversized payloads so users can investigate instead of
    silently getting 413/400.
    """
    body_bytes = len(json.dumps(payload).encode("utf-8"))
    if body_bytes > byte_cap:
        print(
            f"WARNING: {fname} payload is {body_bytes}B > {byte_cap}B "
            f"(body cap on `source` field). Endpoint will likely reject with 413.",
            file=sys.stderr,
        )
    source = payload.get("source", "")
    calls = payload.get("calls", []) or []
    rendered = source + "\n".join(calls)
    approx_tokens = max(1, len(rendered) // 4)
    if approx_tokens > token_cap:
        print(
            f"WARNING: {fname} prompt is ~{approx_tokens} tokens > "
            f"{token_cap}-token cap. Endpoint will likely reject.",
            file=sys.stderr,
        )


def _audit_per_function(contract_name: str, contract_src: str, args) -> None:
    """Extract per-function data via the bundled JS call-graph tool, post each to /v1/audit-anon.

    Each call to /v1/audit-anon carries ONE function in the shape:
        ## Contract: ...
        ## Function: ...
        ### Source Code
        ### Called Functions (call graph context)
    The server builds the prompt from the structured fields so the CLI doesn't have to.
    """
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile(mode="w", suffix=".sol", delete=False) as f:
        f.write(contract_src)
        tmp_path = f.name

    # Locate the bundled JS tool: <skill>/solidity-graph/get_function_graph.js
    js_tool = Path(__file__).resolve().parent.parent / "solidity-graph" / "get_function_graph.js"
    if not js_tool.exists():
        print(f"ERROR: JS tool not found at {js_tool}", file=sys.stderr)
        sys.exit(1)

    script = (
        f"const {{ analyzeSolidityContract }} = require({json.dumps(str(js_tool))});\n"
        f"const r = analyzeSolidityContract(process.argv[1]);\n"
        f"process.stdout.write(JSON.stringify(r));"
    )

    try:
        try:
            r = subprocess.run(
                ["node", "-e", script, tmp_path],
                capture_output=True, text=True, timeout=60,
            )
        except FileNotFoundError:
            print("ERROR: node.js is required for the call-graph tool. "
                  "Install from https://nodejs.org", file=sys.stderr)
            sys.exit(1)
        if r.returncode != 0:
            print(f"ERROR: JS tool failed: {r.stderr.strip() or r.stdout.strip()}",
                  file=sys.stderr)
            sys.exit(1)
        analysis = json.loads(r.stdout)
        funcs_raw = analysis.get("functions", {})
        funcs = []
        cname_for_post = args.name or contract_name.split(".")[0]
        for fname, fdata in funcs_raw.items():
            source = fdata.get("source", "") or ""
            if not source.strip():
                print(f"  - {fname}: skipped (no source)", file=sys.stderr)
                continue
            calls_lines = _render_callees_sft(fdata.get("calls", []) or [])
            funcs.append({
                "function": fname,
                "source": source,
                "calls": calls_lines,
            })
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not funcs:
        print("ERROR: no audit-able functions extracted from contract",
              file=sys.stderr)
        sys.exit(2)

    print(f"Extracted {len(funcs)} function(s) from {contract_name}:",
          file=sys.stderr)
    for f in funcs:
        print(f"  - {f['function']} ({len(f['calls'])} callee(s))",
              file=sys.stderr)

    # ── Audit each function via /v1/audit-anon ──
    vulnerable_count = 0
    safe_count = 0
    for i, f in enumerate(funcs, 1):
        print(f"\n{'=' * 60}", file=sys.stderr)
        print(f"[{i}/{len(funcs)}] {f['function']}", file=sys.stderr)
        print(f"{'=' * 60}", file=sys.stderr)

        payload = {
            "contract": cname_for_post,
            "function": f["function"],
            "source": f["source"],
            "calls": f["calls"],
        }
        _payload_size_warning(payload, f["function"])

        status, body = request(
            "POST", "/v1/audit-anon",
            body=payload, timeout=args.timeout,
        )
        if status == 200 and isinstance(body, dict):
            content = body.get("choices", [{}])[0].get("message", {}).get(
                "content", "<no content>")
            print(f"=== {cname_for_post}.{f['function']} ===")
            print(content)
            if "VULNERABLE" in content.upper():
                vulnerable_count += 1
            elif "SAFE" in content.upper():
                safe_count += 1
            if args.json:
                print(f"\n--- usage: {body.get('usage', {})} ---",
                      file=sys.stderr)
        else:
            print(f"HTTP {status}", file=sys.stderr)
            print_result(status, body)
            if status == 429:
                print(f"\n⛔ Rate limit hit. Skipping remaining functions.",
                      file=sys.stderr)
                break
            if status == 413:
                print(f"\n⛔ Body too large. Skipping remaining functions.",
                      file=sys.stderr)
                break

    print(f"\n{'=' * 60}", file=sys.stderr)
    print(f"SUMMARY: {len(funcs)} function(s) audited, "
          f"{vulnerable_count} VULNERABLE, {safe_count} SAFE",
          file=sys.stderr)
    print(f"{'=' * 60}", file=sys.stderr)


def cmd_audit(args):
    """Audit a Solidity contract via the anonymous endpoint (per-function, SFT-aligned)."""
    if args.stdin:
        contract_src = sys.stdin.read()
        contract_name = args.name or "<stdin>"
    elif args.contract:
        path = Path(args.contract)
        if not path.exists():
            print(f"ERROR: file not found: {path}", file=sys.stderr)
            sys.exit(2)
        contract_src = path.read_text()
        contract_name = args.name or path.name
    else:
        print("ERROR: pass --contract PATH or --stdin", file=sys.stderr)
        sys.exit(2)

    return _audit_per_function(contract_name=contract_name, contract_src=contract_src, args=args)


def cmd_audit_functions(args):
    """Convenience alias for `audit`."""
    return cmd_audit(args)


# ── Argparse ──────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="model_alpha_cli",
        description="CLI for the Model Alpha Solidity vulnerability audit endpoint",
    )

    sub = p.add_subparsers(dest="cmd", required=True)

    # health
    h = sub.add_parser("health", help="GET /health")
    h.set_defaults(func=cmd_health)

    # models
    m = sub.add_parser("models", help="GET /v1/models (OpenAI-compat)")
    m.set_defaults(func=cmd_models)

    # audit-limits
    al2 = sub.add_parser("audit-limits",
                         help="Show the limits advertised by the endpoint")
    al2.set_defaults(func=cmd_audit_anon_limits)

    # audit
    a = sub.add_parser("audit", help="Audit a Solidity contract (per-function)")
    src = a.add_mutually_exclusive_group(required=True)
    src.add_argument("--contract", help="Path to .sol file")
    src.add_argument("--stdin", action="store_true", help="Read contract from stdin")
    a.add_argument("--name", default=None, help="Contract name (default: filename)")
    a.add_argument("--timeout", type=int, default=300,
                   help="Per-request timeout in seconds (default: 300 = 5min)")
    a.add_argument("--json", action="store_true", help="Also print JSON metadata")
    a.set_defaults(func=cmd_audit)

    # audit-functions (alias for audit)
    af = sub.add_parser("audit-functions",
                        help="Convenience alias for `audit`")
    af_src = af.add_mutually_exclusive_group(required=True)
    af_src.add_argument("--contract", help="Path to .sol file")
    af_src.add_argument("--stdin", action="store_true", help="Read contract from stdin")
    af.add_argument("--name", default=None, help="Contract name (default: filename)")
    af.add_argument("--timeout", type=int, default=300,
                    help="Per-request timeout in seconds (default: 300 = 5min)")
    af.add_argument("--json", action="store_true", help="Also print JSON metadata")
    af.set_defaults(func=cmd_audit_functions)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
