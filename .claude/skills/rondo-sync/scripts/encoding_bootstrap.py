"""Windows 下的 stdout 编码自举。

Windows 上 Python 的 stdout 默认编码是 GBK（跟随系统 locale），不是 UTF-8。
本仓的脚本输出大量中文，GBK 会把它们静默转成乱码——不报错，但会一路写进
平台 Skill 文件。

`PYTHONUTF8=1` 环境变量能解决跨进程传导（子进程继承），但**必须在进程启动前**
设置：运行时改 `os.environ` 对当前进程无效，因为编码在解释器初始化时已固化。
所以「直接运行某个脚本」这条路径只能靠 `sys.stdout.reconfigure()` 自救。

两者叠加：环境变量管父子传导，reconfigure 管直接调用。
"""
from __future__ import annotations

import sys


def ensure_utf8_output() -> None:
    """把 stdout / stderr 切到 UTF-8；已是 UTF-8 或流不可重配时保持原样。"""
    for stream in (sys.stdout, sys.stderr):
        encoding = (getattr(stream, "encoding", None) or "").lower()
        # utf-8 / utf8 / cp65001（Windows 控制台 UTF-8 码页）都已满足。
        if encoding in ("utf-8", "utf8", "cp65001"):
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue  # 被替换成非 TextIOWrapper 的流（如 pytest 捕获），保持原样
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            # 极少数环境（如已关闭的流）不允许重配，不影响主流程。
            pass


ensure_utf8_output()
