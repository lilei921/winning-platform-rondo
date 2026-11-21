"""multica CLI 调用的传输层重试规则。

97 服务端偶发连接抖动会让只读命令失败（连接被拒 / 超时 / 响应截断）。这类故障
重试即可恢复；业务面失败（403 权限、404 未找到、参数非法）重试没有意义，必须
立刻上抛。

只对幂等读命令启用重试。写命令（agent env set、repo add、mcp add 等）一律不重试：
写请求可能已经在服务端落地，重试会造成重复写入或状态错乱。
"""
from __future__ import annotations

import subprocess
import time
from typing import Any

# 传输层故障特征：CLI 把「连不上服务端」统一映射为 rc=2 + 下列文案。
TRANSIENT_OUTPUT_MARKERS = (
    "could not reach",
    "connection refused",
    "econnreset",
    "etimedout",
    "socket hang up",
    "unexpected end of json input",
    "i/o timeout",
    "connection reset",
)

# 只读命令的重试次数与退避基数（秒）。
READ_RETRIES = 3
READ_RETRY_BASE_DELAY = 1.0


def is_transient_output(*streams: str | None) -> bool:
    """判断命令输出是否命中传输层故障特征（大小写不敏感）。"""
    text = "\n".join(s for s in streams if s).lower()
    return any(marker in text for marker in TRANSIENT_OUTPUT_MARKERS)


def run_cli(
    args: list[str],
    *,
    stdin_text: str | None = None,
    env: dict[str, str] | None = None,
    timeout: int | None = 120,
    transient: bool = False,
) -> subprocess.CompletedProcess:
    """执行 multica 命令；transient=True 时对传输层故障重试（仅限幂等读）。

    重试次数耗尽后返回最后一次结果，由调用方按原有语义判错。
    """
    attempts = READ_RETRIES if transient else 1
    for attempt in range(attempts):
        out = subprocess.run(
            args,
            input=stdin_text,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=timeout,
        )
        if not transient or attempt >= attempts - 1:
            return out
        # rc=0 说明成功；rc 非 0 且命中传输层特征才算瞬态故障。
        if out.returncode == 0 or not is_transient_output(out.stderr, out.stdout):
            return out
        time.sleep(READ_RETRY_BASE_DELAY * (2 ** attempt))
    return out  # pragma: no cover


def run_cli_json(
    args: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout: int | None = 120,
) -> Any:
    """执行只读 multica 命令并解析 JSON 输出；传输层故障自动重试。"""
    import json

    out = run_cli(args, env=env, timeout=timeout, transient=True)
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout).strip()[:200])
    return json.loads(out.stdout)
