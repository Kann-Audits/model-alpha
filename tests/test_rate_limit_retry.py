import importlib.util
from pathlib import Path
import unittest

CLI_PATH = Path(__file__).parents[1] / "scripts" / "model_alpha_cli.py"
spec = importlib.util.spec_from_file_location("model_alpha_cli", CLI_PATH)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class RateLimitRetryTests(unittest.TestCase):
    def test_retries_429_after_wait_and_returns_full_success_response(self):
        responses = iter([
            (429, {"error": {"message": "Rate limit exceeded: 3 requests per minute"}}),
            (200, {"choices": [{"message": {"content": "Impact: none\nVerdict: SAFE"}}]}),
        ])
        waits = []

        status, body, attempts = cli.post_audit_with_retry(
            {"contract": "C", "function": "f", "source": "function f() external {}", "calls": []},
            timeout=30,
            rate_limit_wait_seconds=2,
            request_fn=lambda *args, **kwargs: next(responses),
            sleep_fn=waits.append,
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["choices"][0]["message"]["content"], "Impact: none\nVerdict: SAFE")
        self.assertEqual(attempts, 2)
        self.assertEqual(waits, [2])

    def test_displays_full_error_body_without_raising_or_hiding_it(self):
        rendered = []
        verdict = cli.display_audit_response(
            "C", "f", 413,
            {"error": {"message": "Input too large: ~8200 tokens", "type": "input_too_large"}},
            print_fn=rendered.append,
        )

        self.assertEqual(verdict, "ERROR")
        self.assertIn("HTTP 413", "\n".join(rendered))
        self.assertIn("Input too large: ~8200 tokens", "\n".join(rendered))


if __name__ == "__main__":
    unittest.main()
