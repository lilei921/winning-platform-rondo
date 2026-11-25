"""传输层重试回归：只读命令重试，写命令与业务错误不重试；不访问真实平台。"""
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import cli_retry
import disable_runtime_skills as disable


def completed(rc, stdout="", stderr=""):
    return subprocess.CompletedProcess([], rc, stdout, stderr)


class CliRetryTests(unittest.TestCase):
    def test_transient_marker_detection(self):
        self.assertTrue(cli_retry.is_transient_output("Could not reach the Multica server."))
        self.assertTrue(cli_retry.is_transient_output(None, "ECONNRESET"))
        self.assertTrue(cli_retry.is_transient_output("Unexpected end of JSON input"))
        self.assertFalse(cli_retry.is_transient_output("You do not have permission"))
        self.assertFalse(cli_retry.is_transient_output(None, None))

    def test_read_retries_transient_failure_then_succeeds(self):
        calls = []
        responses = [completed(2, "", "Could not reach the Multica server."), completed(0, "[]")]

        def fake_run(args, **kwargs):
            calls.append(args)
            return responses[len(calls) - 1]

        with patch.object(cli_retry.subprocess, "run", side_effect=fake_run), \
             patch.object(cli_retry.time, "sleep"):
            out = cli_retry.run_cli(["multica", "workspace", "list"], transient=True)
        self.assertEqual(out.returncode, 0)
        self.assertEqual(len(calls), 2)

    def test_read_gives_up_after_retry_budget(self):
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            return completed(2, "", "Could not reach the Multica server.")

        with patch.object(cli_retry.subprocess, "run", side_effect=fake_run), \
             patch.object(cli_retry.time, "sleep"):
            out = cli_retry.run_cli(["multica", "workspace", "list"], transient=True)
        self.assertEqual(out.returncode, 2)
        self.assertEqual(len(calls), cli_retry.READ_RETRIES)

    def test_business_failure_is_not_retried(self):
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            return completed(1, "", "You do not have permission to perform this action")

        with patch.object(cli_retry.subprocess, "run", side_effect=fake_run), \
             patch.object(cli_retry.time, "sleep"):
            out = cli_retry.run_cli(["multica", "repo", "add"], transient=True)
        self.assertEqual(out.returncode, 1)
        self.assertEqual(len(calls), 1)

    def test_write_command_never_retries(self):
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            return completed(2, "", "Could not reach the Multica server.")

        with patch.object(cli_retry.subprocess, "run", side_effect=fake_run), \
             patch.object(cli_retry.time, "sleep"):
            out = cli_retry.run_cli(["multica", "agent", "env", "set"])
        self.assertEqual(out.returncode, 2)
        self.assertEqual(len(calls), 1)

    def test_run_cli_json_raises_on_non_zero(self):
        with patch.object(cli_retry.subprocess, "run", return_value=completed(1, "", "boom")):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                cli_retry.run_cli_json(["multica", "workspace", "list"])


class HttpRetryTests(unittest.TestCase):
    """disable_runtime_skills 的 HTTP 客户端：读重试，写不重试。"""

    def client(self):
        return disable.MulticaClient("http://example.invalid", "mul_test", "ws-1")

    def test_read_retries_connection_refused(self):
        import urllib.error

        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req)
            if len(calls) == 1:
                raise urllib.error.URLError(ConnectionRefusedError("refused"))
            import io
            return io.BytesIO(json.dumps([]).encode("utf-8"))

        with patch.object(disable.urllib.request, "urlopen", side_effect=fake_urlopen), \
             patch.object(disable.time, "sleep"):
            result = self.client().list_agents("ws-1")
        self.assertEqual(result, [])
        self.assertEqual(len(calls), 2)

    def test_read_does_not_retry_http_error(self):
        import urllib.error

        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req)
            raise urllib.error.HTTPError(req.full_url, 403, "forbidden", {}, None)

        with patch.object(disable.urllib.request, "urlopen", side_effect=fake_urlopen), \
             patch.object(disable.time, "sleep"):
            with self.assertRaisesRegex(disable.ApiError, "HTTP 403"):
                self.client().list_agents("ws-1")
        self.assertEqual(len(calls), 1)

    def test_write_does_not_retry(self):
        import urllib.error

        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req)
            raise urllib.error.URLError(ConnectionRefusedError("refused"))

        with patch.object(disable.urllib.request, "urlopen", side_effect=fake_urlopen), \
             patch.object(disable.time, "sleep"):
            with self.assertRaisesRegex(disable.ApiError, "Connection failed"):
                self.client().disable_skill("a-1", "r-1", {"root": "universal", "key": "k"})
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
