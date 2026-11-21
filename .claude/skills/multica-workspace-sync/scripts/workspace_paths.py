"""同步脚本共享的仓库定位规则，不依赖全局仓库路径变量。"""
from __future__ import annotations

import os
from pathlib import Path

MANIFEST_REL = Path("workspace-config") / "provisioning.json"


def find_repo_root(start: Path | None = None, repo_root: str | None = None) -> Path:
    """优先使用本次输入的路径，其次从当前目录、脚本目录上溯。"""
    if repo_root is not None:
        candidate = Path(repo_root).expanduser().resolve()
        if not (candidate / MANIFEST_REL).is_file():
            raise SystemExit(f"仓库路径无效（缺少 {MANIFEST_REL}）：{candidate}。请重新输入 --repo-root <仓库根目录>。")
        return candidate
    for base in (Path.cwd(), (start or Path(__file__).parent).resolve()):
        for candidate in (base, *base.parents):
            if (candidate / MANIFEST_REL).is_file():
                return candidate
    raise SystemExit(f"未找到仓库根（缺少 {MANIFEST_REL}）。请输入仓库路径：--repo-root <仓库根目录>。")


def command_env() -> dict[str, str]:
    """让子进程使用选定的工作目录，屏蔽历史变量但不修改用户环境。

    额外注入 PYTHONUTF8 / PYTHONIOENCODING：Windows 上 Python 默认用 GBK 输出，
    子脚本的中文会静默变乱码。该变量在子进程**启动时**生效，正好补上环境变量
    传导这一环（本进程自身的编码由 encoding_bootstrap 负责）。
    """
    env = {key: value for key, value in os.environ.items() if key.upper() != "MULTICA_REPO_ROOT"}
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env
