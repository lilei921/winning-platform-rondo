# OpenSpec 双仓分离并发方案

## 版本信息

| 项目 | 内容 |
|------|------|
| 版本 | v1.1 |
| 日期 | 2026-11-02 |
| 状态 | 设计完成，待实施 |

---

## 1. 背景与问题

### 1.1 现状

在 Multica 多 Agent 协作开发中，OpenSpec 变更管理面临以下挑战：

- **目录锁冲突**：同一 Agent 在 inplace 模式下无法并发处理多个任务
- **规范与代码耦合**：OpenSpec 变更与业务代码在同一仓库，互相影响
- **并发度受限**：Git 单仓库模型限制并行开发能力

### 1.2 核心矛盾

| 需求 | 约束 |
|------|------|
| OpenSpec 变更需原子化、可追溯 | 同一目录串行执行 |
| 代码实现需高并发 | 锁与目录生命周期绑定 |
| 规范与代码版本对应 | 单仓库分支策略耦合 |

---

## 2. 方案概述

### 2.1 核心思想

> **规范串行保一致，实现并行提效率。**

通过**双仓分离**架构，将 OpenSpec 规范仓与业务代码仓完全独立：

- **openspec-central**：inplace 模式，严格串行，保证规范一致性
- **business-workspace**：worktree 模式，高并发，支持并行开发

### 2.2 架构图

```
┌─────────────────────────────────────────┐
│         OpenSpec Orchestrator           │
│  ┌─────────────────────────────────┐    │
│  │  事件监听 (Webhook / Polling)   │    │
│  │  状态机管理                      │    │
│  │  冲突检测与解决                  │    │
│  │  双向同步引擎                    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
              ↑              ↓
    ┌─────────┴──┐    ┌──────┴─────┐
    ↓            ↓    ↓            ↓
┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│Spec    │  │Spec    │  │Code    │  │Code    │
│Task 1  │  │Task 2  │  │Task A  │  │Task B  │
│(review)│  │(approve)│  │(impl)  │  │(impl)  │
└────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘
     │           │           │           │
     └───────────┴───────────┴───────────┘
                 ↓
┌─────────────────────────────────────────┐
│  openspec-central ←→ business-workspace │
│  (inplace, 串行)      (worktree, 并行)  │
└─────────────────────────────────────────┘
```

---

## 3. 仓库结构设计

### 3.1 openspec-central（规范仓）

```
openspec-central/
├── .git/
├── .multica/
│   └── config.yaml              # Multica 项目配置
├── openspec/
│   ├── config.yaml              # OpenSpec 全局配置
│   ├── changes/                 # 进行中的变更
│   │   ├── auth-v2/
│   │   │   ├── meta.yaml        # 变更元数据（关键）
│   │   │   ├── proposal.md      # 提案文档
│   │   │   ├── design.md        # 设计文档
│   │   │   └── tasks.md         # 任务清单
│   │   └── logging-v1/
│   │       └── ...
│   └── archive/                 # 已完成的变更
│       └── auth-v1/
├── .sync/
│   └── state.json               # 同步状态记录
└── README.md
```

**关键文件：meta.yaml**

```yaml
id: auth-v2
title: Authentication V2
status: approved                    # proposal | review | approved | implementing | completed | archived
created_at: 2026-11-01T10:00:00Z
updated_at: 2026-11-02T15:30:00Z

# 同步相关
sync:
  version: 3                        # 每次变更递增
  last_synced_at: 2026-11-02T15:35:00Z
  implementations:                  # 关联的实现任务
    - repo: business-workspace
      task_id: mul-task-123
      branch: feat/auth-v2
      status: running               # pending | running | completed | failed
      worktree: .multica/worktrees/mul-task-123
      last_commit: abc123

# 依赖关系
dependencies:
  changes: []                       # 依赖的其他变更
  blocking: []                      # 阻塞的其他变更
```

### 3.2 business-workspace（业务仓）

```
business-workspace/
├── .git/
├── .multica/
│   ├── config.yaml              # Multica 项目配置
│   ├── worktrees/               # 任务工作区
│   │   ├── mul-task-123/        # auth-v2 实现
│   │   └── mul-task-124/        # logging-v1 实现
│   ├── spec-cache/              # 规范缓存（只读）
│   │   ├── auth-v2/
│   │   │   ├── meta.yaml
│   │   │   └── proposal.md
│   │   └── logging-v1/
│   ├── spec-refs/               # 规范引用
│   │   ├── auth-v2.yaml
│   │   └── logging-v1.yaml
│   ├── conflicts/               # 冲突记录
│   └── sync-state.json          # 本地同步状态
├── services/
│   ├── auth/
│   ├── logging/
│   └── core/
├── tests/
└── README.md
```

**关键文件：spec-refs/auth-v2.yaml**

```yaml
change_id: auth-v2
spec_repo: openspec-central
spec_path: openspec/changes/auth-v2
spec_version: 3                     # 锁定的规范版本
spec_commit: def456

# 本地缓存
cache_path: .multica/spec-cache/auth-v2
cached_at: 2026-11-02T15:35:00Z

# 实现状态
implementation:
  task_id: mul-task-123
  branch: feat/auth-v2
  worktree: .multica/worktrees/mul-task-123
  status: running
  started_at: 2026-11-02T15:40:00Z

# 只读保护
readonly: true
```

---

## 4. Multica 配置

### 4.1 openspec-central/.multica/config.yaml

```yaml
project:
  name: openspec-central
  mode: inplace

concurrency:
  max_concurrent_tasks: 1         # 严格串行

agent:
  allowed_tasks:
    - spec-proposal
    - spec-review
    - spec-archive

sync:
  role: spec_source               # 规范源
  target_repo: ../business-workspace
```

### 4.2 business-workspace/.multica/config.yaml

```yaml
project:
  name: business-workspace
  mode: worktree

concurrency:
  max_concurrent_tasks: 5         # 高并发

worktree:
  base_dir: .multica/worktrees
  naming: "{task-id}-{branch}"

agent:
  allowed_tasks:
    - code-implementation
    - code-review
    - code-test

sync:
  role: spec_consumer             # 规范消费方
  source_repo: ../openspec-central
  cache_dir: .multica/spec-cache
  refs_dir: .multica/spec-refs
```

---

## 5. 同步机制

### 5.1 同步模式选择

| 模式 | 触发方式 | 实时性 | 复杂度 | 适用场景 |
|------|---------|--------|--------|----------|
| A. 事件驱动 | Webhook | 高 | 高 | 大型团队，CI/CD 密集 |
| B. 轮询同步 | 定时任务 | 中 | 中 | 中小团队，简单可靠 |
| C. 混合模式 | Webhook + 补偿轮询 | 高 | 高 | **生产推荐** |

### 5.2 混合同步架构

```
┌─────────────────────────────────────────┐
│           Hybrid Sync                   │
│                                         │
│  实时层: Webhook (秒级)                 │
│  ├── spec-updated → 立即同步缓存        │
│  └── impl-completed → 立即更新规范      │
│                                         │
│  补偿层: 轮询 (5分钟)                   │
│  ├── 检测遗漏的 Webhook                 │
│  ├── 修复状态不一致                     │
│  └── 清理过期缓存                       │
│                                         │
│  审计层: 日志 + 指标                    │
│  ├── 同步延迟                           │
│  ├── 冲突频率                           │
│  └── 失败率                             │
│                                         │
└─────────────────────────────────────────┘
```

### 5.3 同步引擎实现

```python
#!/usr/bin/env python3
"""
OpenSpec Sync Engine
双仓同步引擎
"""

import os
import json
import time
import shutil
import subprocess
import hashlib
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Literal
from datetime import datetime
import yaml

# ============ 数据模型 ============

ChangeStatus = Literal[
    "proposal", "review", "approved", 
    "implementing", "completed", "archived", "rejected"
]

ImplStatus = Literal[
    "pending", "running", "completed", "failed", "cancelled"
]

@dataclass
class SpecChange:
    id: str
    status: ChangeStatus
    version: int
    updated_at: str
    spec_path: Path

@dataclass
class Implementation:
    change_id: str
    task_id: str
    repo: str
    branch: str
    status: ImplStatus
    worktree: Optional[Path]
    last_commit: Optional[str]

@dataclass
class SyncState:
    last_sync: str
    spec_changes: Dict[str, int]  # change_id -> version
    impl_status: Dict[str, str]   # task_id -> status

# ============ 同步引擎 ============

class SpecSyncEngine:
    def __init__(
        self,
        spec_repo: Path,
        impl_repo: Path,
        poll_interval: int = 30,
        state_file: Optional[Path] = None
    ):
        self.spec_repo = spec_repo
        self.impl_repo = impl_repo
        self.poll_interval = poll_interval
        self.state_file = state_file or impl_repo / ".multica/sync-state.json"
        self.state = self._load_state()

    def _load_state(self) -> SyncState:
        """加载同步状态"""
        if self.state_file.exists():
            data = json.loads(self.state_file.read_text())
            return SyncState(**data)
        return SyncState(
            last_sync="",
            spec_changes={},
            impl_status={}
        )

    def _save_state(self):
        """保存同步状态"""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(json.dumps(asdict(self.state), indent=2))

    # ========== 规范仓扫描 ==========

    def scan_spec_changes(self) -> List[SpecChange]:
        """扫描规范仓中的所有变更"""
        changes = []
        changes_dir = self.spec_repo / "openspec/changes"

        if not changes_dir.exists():
            return changes

        for change_dir in sorted(changes_dir.iterdir()):
            if not change_dir.is_dir():
                continue

            meta_file = change_dir / "meta.yaml"
            if not meta_file.exists():
                continue

            meta = yaml.safe_load(meta_file.read_text())
            changes.append(SpecChange(
                id=change_dir.name,
                status=meta.get("status", "proposal"),
                version=meta.get("sync", {}).get("version", 0),
                updated_at=meta.get("updated_at", ""),
                spec_path=change_dir
            ))

        return changes

    # ========== 业务仓扫描 ==========

    def scan_implementations(self) -> List[Implementation]:
        """扫描业务仓中的实现任务"""
        impls = []
        refs_dir = self.impl_repo / ".multica/spec-refs"

        if not refs_dir.exists():
            return impls

        for ref_file in refs_dir.glob("*.yaml"):
            ref = yaml.safe_load(ref_file.read_text())
            impls.append(Implementation(
                change_id=ref["change_id"],
                task_id=ref["implementation"]["task_id"],
                repo=ref["implementation"].get("repo", "business-workspace"),
                branch=ref["implementation"]["branch"],
                status=ref["implementation"]["status"],
                worktree=Path(ref["implementation"]["worktree"]) if ref["implementation"].get("worktree") else None,
                last_commit=ref["implementation"].get("last_commit")
            ))

        return impls

    # ========== 同步操作 ==========

    def sync_spec_to_impl(self, change: SpecChange):
        """将规范同步到业务仓缓存"""
        cache_dir = self.impl_repo / ".multica/spec-cache" / change.id
        cache_dir.mkdir(parents=True, exist_ok=True)

        # 复制所有文件
        for file in change.spec_path.rglob("*"):
            if file.is_file():
                rel_path = file.relative_to(change.spec_path)
                target = cache_dir / rel_path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file, target)

        # 设置只读权限
        for file in cache_dir.rglob("*"):
            if file.is_file():
                os.chmod(file, 0o444)

        # 更新引用文件
        ref_file = self.impl_repo / ".multica/spec-refs" / f"{change.id}.yaml"
        ref_file.parent.mkdir(parents=True, exist_ok=True)

        spec_commit = self._get_git_commit(self.spec_repo)

        ref_data = {
            "change_id": change.id,
            "spec_repo": "openspec-central",
            "spec_path": f"openspec/changes/{change.id}",
            "spec_version": change.version,
            "spec_commit": spec_commit,
            "cache_path": f".multica/spec-cache/{change.id}",
            "cached_at": datetime.now().isoformat(),
            "readonly": True,
            "implementation": {
                "status": "pending"
            }
        }

        ref_file.write_text(yaml.dump(ref_data, default_flow_style=False))

        print(f"[SYNC] Spec {change.id} v{change.version} -> cache")

    def sync_impl_status_to_spec(self, impl: Implementation):
        """将实现状态同步回规范仓"""
        meta_file = self.spec_repo / "openspec/changes" / impl.change_id / "meta.yaml"
        if not meta_file.exists():
            print(f"[WARN] Meta file not found: {meta_file}")
            return

        meta = yaml.safe_load(meta_file.read_text())

        # 更新实现状态
        if "sync" not in meta:
            meta["sync"] = {}
        if "implementations" not in meta["sync"]:
            meta["sync"]["implementations"] = []

        # 查找或添加实现记录
        impl_record = None
        for rec in meta["sync"]["implementations"]:
            if rec.get("task_id") == impl.task_id:
                impl_record = rec
                break

        if impl_record is None:
            impl_record = {"task_id": impl.task_id}
            meta["sync"]["implementations"].append(impl_record)

        impl_record.update({
            "repo": impl.repo,
            "branch": impl.branch,
            "status": impl.status,
            "worktree": str(impl.worktree) if impl.worktree else None,
            "last_commit": impl.last_commit,
            "updated_at": datetime.now().isoformat()
        })

        meta["sync"]["last_synced_at"] = datetime.now().isoformat()
        meta_file.write_text(yaml.dump(meta, default_flow_style=False))

        print(f"[SYNC] Impl {impl.task_id} status={impl.status} -> spec")

    def check_impl_progress(self, impl: Implementation) -> Optional[ImplStatus]:
        """检查实现任务的实际进度"""
        if not impl.worktree or not impl.worktree.exists():
            return "failed"

        try:
            # 检查 worktree 中的 git 状态
            result = subprocess.run(
                ["git", "-C", str(impl.worktree), "log", "--oneline", "-1"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode != 0:
                return "failed"

            # 检查是否有未提交的变更
            status = subprocess.run(
                ["git", "-C", str(impl.worktree), "status", "--porcelain"],
                capture_output=True, text=True, timeout=5
            )

            return impl.status

        except Exception as e:
            print(f"[ERROR] Check impl {impl.task_id}: {e}")
            return "failed"

    # ========== 冲突检测 ==========

    def detect_spec_conflicts(self, change: SpecChange) -> List[str]:
        """检测规范变更是否与进行中的实现冲突"""
        conflicts = []

        impls = self.scan_implementations()
        for impl in impls:
            if impl.change_id == change.id and impl.status == "running":
                ref_file = self.impl_repo / ".multica/spec-refs" / f"{change.id}.yaml"
                if ref_file.exists():
                    ref = yaml.safe_load(ref_file.read_text())
                    cached_version = ref.get("spec_version", 0)
                    if cached_version < change.version:
                        conflicts.append(
                            f"Impl {impl.task_id} using v{cached_version}, "
                            f"but spec is now v{change.version}"
                        )

        return conflicts

    def resolve_spec_conflict(self, change: SpecChange, conflict: str):
        """解决规范冲突"""
        print(f"[CONFLICT] {conflict}")

        # 策略：标记冲突，等待人工处理
        conflict_file = self.impl_repo / ".multica/conflicts" / f"{change.id}.yaml"
        conflict_file.parent.mkdir(parents=True, exist_ok=True)
        conflict_file.write_text(yaml.dump({
            "change_id": change.id,
            "conflict": conflict,
            "detected_at": datetime.now().isoformat(),
            "status": "pending_resolution"
        }))

    # ========== Git 辅助 ==========

    def _get_git_commit(self, repo: Path) -> str:
        """获取仓库当前 commit"""
        result = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            capture_output=True, text=True
        )
        return result.stdout.strip()[:8]

    def _commit_spec_changes(self, message: str):
        """提交规范仓的变更"""
        subprocess.run(
            ["git", "-C", str(self.spec_repo), "add", "."],
            check=True
        )
        subprocess.run(
            ["git", "-C", str(self.spec_repo), "commit", "-m", message],
            check=False
        )

    # ========== 主循环 ==========

    def run_once(self):
        """执行一次同步"""
        print(f"\n[SYNC] {datetime.now().isoformat()}")

        # 1. 扫描规范变更
        spec_changes = self.scan_spec_changes()
        print(f"  Found {len(spec_changes)} spec changes")

        for change in spec_changes:
            cached_version = self.state.spec_changes.get(change.id, -1)

            if change.version > cached_version:
                conflicts = self.detect_spec_conflicts(change)
                if conflicts:
                    for conflict in conflicts:
                        self.resolve_spec_conflict(change, conflict)
                else:
                    self.sync_spec_to_impl(change)
                    self.state.spec_changes[change.id] = change.version

        # 2. 扫描实现任务
        impls = self.scan_implementations()
        print(f"  Found {len(impls)} implementations")

        for impl in impls:
            new_status = self.check_impl_progress(impl)
            if new_status and new_status != impl.status:
                impl.status = new_status
                self.sync_impl_status_to_spec(impl)
                self.state.impl_status[impl.task_id] = new_status

        # 3. 保存状态
        self.state.last_sync = datetime.now().isoformat()
        self._save_state()

        # 4. 提交规范仓变更
        self._commit_spec_changes(f"Sync state update {datetime.now().isoformat()}")

    def run_forever(self):
        """持续运行"""
        print(f"Starting sync daemon (interval={self.poll_interval}s)")
        print(f"  Spec repo: {self.spec_repo}")
        print(f"  Impl repo: {self.impl_repo}")

        while True:
            try:
                self.run_once()
            except Exception as e:
                print(f"[ERROR] {e}")

            time.sleep(self.poll_interval)

# ============ CLI ============

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="OpenSpec Sync Daemon")
    parser.add_argument("--spec-repo", default="../openspec-central")
    parser.add_argument("--impl-repo", default=".")
    parser.add_argument("--interval", type=int, default=30)
    parser.add_argument("--once", action="store_true", help="Run once and exit")

    args = parser.parse_args()

    engine = SpecSyncEngine(
        spec_repo=Path(args.spec_repo).resolve(),
        impl_repo=Path(args.impl_repo).resolve(),
        poll_interval=args.interval
    )

    if args.once:
        engine.run_once()
    else:
        engine.run_forever()
```

---

## 6. 工作流程

### 6.1 完整变更生命周期

```
阶段 1: 规范提案（串行，仓库 A）
─────────────────────────────────
Agent-X 认领任务: "Create auth-v2 proposal"
├── 进入 /path/to/openspec-central
├── 创建 openspec/changes/auth-v2/
│   ├── proposal.md
│   ├── design.md
│   └── tasks.md
├── git add openspec/changes/auth-v2/
├── git commit -m "Add auth-v2 proposal"
└── 推送，释放锁

阶段 2: 规范评审（串行，仓库 A）
─────────────────────────────────
Agent-Y 或人工评审
├── 修改 proposal.md
├── 标记 status: approved
└── 提交

阶段 3: 代码实现（并行，仓库 B）
─────────────────────────────────
Agent-X 认领任务: "Implement auth-v2"
├── 检查仓库 A 的 auth-v2 状态 = approved
├── 进入 /path/to/business-workspace
├── 创建 worktree: .multica/wt-auth-v2
├── 基于 feat/auth-v2 分支开发
├── 修改 services/auth/
├── git commit
└── 释放锁

Agent-Z 认领任务: "Implement logging-v1"
├── 同时进入 /path/to/business-workspace
├── 创建另一个 worktree: .multica/wt-logging-v1
├── 基于 feat/logging-v1 分支开发
├── 修改 services/logging/
├── git commit
└── 释放锁（与 Agent-X 并行）

阶段 4: 合并与归档
─────────────────────────────────
人工或 Orchestrator:
├── 合并仓库 B 的 feat/auth-v2 到 main
├── 合并仓库 B 的 feat/logging-v1 到 main
├── 更新仓库 A 的 auth-v2 状态 = implemented
└── 归档 openspec/changes/auth-v2/
```

### 6.2 并发场景验证

| 任务 | 目录 | 锁状态 | 说明 |
|------|------|--------|------|
| Spec: auth-v2 | `/openspec-central` | ✅ 获得 | 唯一任务，无竞争 |
| Spec: logging-v1 | `/openspec-central` | ⏳ 等待 | 同一目录，串行 |
| Impl: auth-v2 | `/business-workspace/.multica/wt-impl-auth-v2` | ✅ 获得 | worktree 隔离 |
| Impl: logging-v1 | `/business-workspace/.multica/wt-impl-logging-v1` | ✅ 获得 | 不同 worktree |

**并发度对比**：

| 方案 | 规范任务 | 实现任务 | 总并发 |
|------|---------|---------|--------|
| 单仓 inplace | 1 | 0 | 1 |
| 单仓 worktree | 1 | 3 | 4 |
| **双仓分离** | 1 | 5 | **6** |

---

## 7. 冲突处理

### 7.1 冲突类型与策略

| 冲突类型 | 检测方式 | 解决策略 |
|---------|---------|---------|
| 规范版本漂移 | 实现使用旧版规范 | 暂停任务，通知更新 |
| 并发修改同一变更 | Git 冲突 | 强制串行（规范仓锁）|
| 实现分支冲突 | 多分支修改同一代码 | worktree 隔离，合并时处理 |
| 状态不一致 | 规范说完成，实现说进行中 | 以实现为准，人工确认 |

### 7.2 自动化冲突解决

```python
def auto_resolve_conflict(change_id: str, conflict_type: str):
    """自动化冲突解决"""
    if conflict_type == "spec_version_drift":
        # 策略：暂停实现，更新缓存，恢复实现
        pause_implementation(change_id)
        update_spec_cache(change_id)
        resume_implementation(change_id)

    elif conflict_type == "branch_conflict":
        # 策略：尝试自动合并，失败则人工介入
        if try_auto_merge(change_id):
            notify("Auto-merged", change_id)
        else:
            escalate_to_human(change_id)
```

---

## 8. 监控与告警

### 8.1 关键指标

```yaml
# .sync/metrics.yaml
metrics:
  sync_latency:
    description: 规范同步延迟
    target: < 30s
    alert: > 60s

  spec_impl_divergence:
    description: 规范与实现版本差
    target: 0
    alert: > 0 for > 5min

  sync_failure_rate:
    description: 同步失败率
    target: < 1%
    alert: > 5%

  conflict_frequency:
    description: 冲突频率
    target: < 1/day
    alert: > 5/day
```

### 8.2 告警配置

```yaml
# .sync/alerts.yaml
alerts:
  - name: sync-latency-high
    condition: sync_latency > 60s
    severity: warning
    notify: [slack:#dev-alerts]

  - name: spec-impl-divergence
    condition: spec_version > impl_version for > 5min
    severity: critical
    notify: [slack:#dev-alerts, email:team@company.com]

  - name: sync-failure
    condition: consecutive_failures > 3
    severity: critical
    notify: [pagerduty:team]
```

---

## 9. 实施路径

### 9.1 阶段规划

| 阶段 | 时间 | 目标 | 产出 |
|------|------|------|------|
| **Phase 1** | 第 1 周 | 基础架构 | 双仓初始化、轮询同步 |
| **Phase 2** | 第 2-3 周 | 实时同步 | Webhook、事件驱动 |
| **Phase 3** | 第 4 周 | 生产就绪 | 监控、告警、冲突自动化 |

### 9.2 Phase 1 详细任务

```
Day 1-2: 仓库初始化
├── 创建 openspec-central 仓库
├── 创建 business-workspace 仓库
├── 配置 Multica 项目
└── 验证目录锁隔离

Day 3-4: 同步引擎
├── 实现 SpecSyncEngine
├── 实现轮询同步
├── 实现状态管理
└── 编写单元测试

Day 5-7: 集成验证
├── 端到端测试
├── 并发场景验证
├── 冲突检测测试
└── 文档完善
```

### 9.3 验收标准

- [ ] 同一 Agent 可同时执行规范任务和实现任务
- [ ] 规范变更自动同步到业务仓缓存
- [ ] 实现状态自动同步回规范仓
- [ ] 规范版本漂移被检测并处理
- [ ] 同步延迟 < 30 秒
- [ ] 系统可用性 > 99%

---

## 10. 工作区绑定（Workspace Binding）

### 10.1 核心概念

用户只感知**工作区（Workspace）**，系统幕后自动路由到正确的仓库和项目。

```
┌─────────────────────────────────────────┐
│           用户工作区                     │
│  （本地开发环境，如 ~/projects/myapp）   │
└─────────────────────────────────────────┘
              ↓ 绑定
    ┌─────────┴─────────┐
    ↓                   ↓
┌──────────┐      ┌──────────┐
│ 仓库 A   │      │ 仓库 B   │
│ openspec │←────→│ business │
│ -central │ 关联  │ -workspace│
│          │      │          │
│ Multica  │      │ Multica  │
│ 项目 A   │      │ 项目 B   │
│ (inplace)│      │ (worktree)│
└──────────┘      └──────────┘
```

### 10.2 绑定维度

| 绑定维度 | 说明 | 示例 |
|---------|------|------|
| **工作区 ↔ 项目** | 一个工作区绑定两个 Multica 项目 | myapp → spec + impl |
| **任务 ↔ 任务** | 规范任务 ↔ 实现任务 | mul-spec-001 ↔ mul-impl-001 |
| **文件 ↔ 文件** | 规范缓存 ↔ 规范源 | cache/auth-v2 ↔ openspec/changes/auth-v2 |
| **状态 ↔ 状态** | 双向同步，保持状态一致 | spec.status ↔ impl.status |

### 10.3 工作区配置

**~/.multica/workspaces/myapp.yaml**：

```yaml
workspace: myapp
created_at: 2026-11-02T20:00:00Z

# 双仓绑定
projects:
  spec:
    name: openspec-central
    path: ~/projects/openspec-central
    mode: inplace
    role: spec_source

  impl:
    name: business-workspace
    path: ~/projects/business-workspace
    mode: worktree
    role: spec_consumer

# 同步配置
sync:
  enabled: true
  direction: bidirectional
  spec_to_impl: true      # 规范 → 实现
  impl_to_spec: true      # 实现状态 → 规范

# 默认设置
defaults:
  create_spec_with_impl: true    # 创建实现任务时自动创建规范提案
  require_spec_approval: true    # 实现前需要规范批准
```

### 10.4 绑定关系存储

```
~/.multica/
├── workspaces/
│   ├── myapp/
│   │   ├── config.yaml          # 工作区配置
│   │   ├── state.json           # 运行时状态
│   │   └── links/               # 任务绑定关系
│   │       ├── auth-v2.json     # 规范↔实现绑定
│   │       └── logging-v1.json
│   └── other-app/
│       └── ...
└── daemon.log
```

**绑定关系文件：myapp/links/auth-v2.json**：

```json
{
  "change_id": "auth-v2",
  "created_at": "2026-11-02T20:00:00Z",

  "spec": {
    "project": "openspec-central",
    "task_id": "mul-spec-001",
    "path": "openspec/changes/auth-v2",
    "status": "approved",
    "version": 3,
    "commit": "def456"
  },

  "impl": {
    "project": "business-workspace",
    "task_id": "mul-impl-001",
    "branch": "feat/auth-v2",
    "worktree": ".multica/workspaces/myapp/wt-auth-v2",
    "status": "running"
  },

  "sync": {
    "last_sync": "2026-11-02T20:30:00Z",
    "spec_cached_version": 3,
    "impl_last_commit": "abc123"
  }
}
```

### 10.5 工作区操作命令

```bash
# 创建 workspace
multica workspace create myapp \
  --spec-repo ~/projects/openspec-central \
  --impl-repo ~/projects/business-workspace

# 切换 workspace
multica workspace use myapp

# 创建规范提案（自动路由到仓库 A）
multica spec create --title "auth-v2"

# 提交规范评审
multica spec submit auth-v2

# 批准后开始实现（自动路由到仓库 B）
multica spec approve auth-v2
multica impl create --spec auth-v2 --branch feat/auth-v2

# 查看跨项目状态
multica workspace status
```

**输出示例**：

```
┌─────────────┬──────────┬─────────────┬───────────┐
│ Change      │ Spec     │ Impl Task   │ Status    │
├─────────────┼──────────┼─────────────┼───────────┤
│ auth-v2     │ approved │ mul-task-123│ running   │
│ logging-v1  │ approved │ mul-task-124│ running   │
│ api-v2      │ proposal │ -           │ -         │
└─────────────┴──────────┴─────────────┴───────────┘
```

### 10.6 包装脚本实现

```bash
#!/bin/bash
# multica-ws.sh - 工作区包装器

WS_NAME=${MULTICA_WS:-default}
WS_CONFIG=~/.multica/workspaces/${WS_NAME}.yaml

# 读取配置
SPEC_REPO=$(yq eval '.projects.spec.path' $WS_CONFIG)
IMPL_REPO=$(yq eval '.projects.impl.path' $WS_CONFIG)
SPEC_MODE=$(yq eval '.projects.spec.mode' $WS_CONFIG)
IMPL_MODE=$(yq eval '.projects.impl.mode' $WS_CONFIG)

CMD=$1
shift

case "$CMD" in
  spec)
    # 规范操作 → 仓库 A
    cd $SPEC_REPO
    multica issue create --mode $SPEC_MODE "$@"
    ;;

  impl)
    # 实现操作 → 仓库 B
    cd $IMPL_REPO
    multica issue create --mode $IMPL_MODE "$@"
    ;;

  sync)
    # 同步操作
    python3 spec_sync_daemon.py \
      --spec-repo $SPEC_REPO \
      --impl-repo $IMPL_REPO \
      --once
    ;;

  status)
    # 跨项目状态
    echo "=== Spec Changes ==="
    cd $SPEC_REPO && multica issue list

    echo -e "\n=== Implementations ==="
    cd $IMPL_REPO && multica issue list
    ;;

  *)
    echo "Usage: $0 {spec|impl|sync|status}"
    exit 1
    ;;
esac
```

### 10.7 Orchestrator 实现

```python
#!/usr/bin/env python3
"""
WorkspaceOrchestrator - 工作区编排器
管理双仓绑定和任务路由
"""

import yaml
import json
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

@dataclass
class SpecBinding:
    project: str
    task_id: str
    path: str
    status: str
    version: int
    commit: str

@dataclass
class ImplBinding:
    project: str
    task_id: str
    branch: str
    worktree: str
    status: str

@dataclass
class Binding:
    change_id: str
    spec: SpecBinding
    impl: Optional[ImplBinding]

class WorkspaceOrchestrator:
    """工作区编排器"""

    def __init__(self, workspace_name: str):
        self.workspace = workspace_name
        self.config = self._load_config()
        self.spec_project = self.config['projects']['spec']
        self.impl_project = self.config['projects']['impl']
        self.links_dir = Path.home() / '.multica/workspaces' / workspace_name / 'links'

    def _load_config(self) -> dict:
        config_path = Path.home() / '.multica/workspaces' / self.workspace / 'config.yaml'
        return yaml.safe_load(config_path.read_text())

    # ========== 规范操作 ==========

    def create_spec(self, title: str) -> str:
        """创建规范提案"""
        # 在规范仓创建任务
        task_id = multica.create_task(
            project=self.spec_project['name'],
            title=title,
            mode='inplace'
        )

        # 自动初始化规范目录
        spec_dir = Path(self.spec_project['path']) / 'openspec/changes' / task_id
        spec_dir.mkdir(parents=True, exist_ok=True)

        # 创建模板文件
        self._create_spec_templates(spec_dir, title)

        # 创建绑定关系
        binding = Binding(
            change_id=task_id,
            spec=SpecBinding(
                project=self.spec_project['name'],
                task_id=task_id,
                path=f'openspec/changes/{task_id}',
                status='proposal',
                version=1,
                commit=''
            ),
            impl=None
        )
        self._save_binding(binding)

        return task_id

    def submit_spec(self, change_id: str) -> None:
        """提交规范评审"""
        binding = self._load_binding(change_id)
        binding.spec.status = 'review'
        self._save_binding(binding)

        # 更新规范仓 meta.yaml
        self._update_spec_meta(change_id, status='review')

    def approve_spec(self, change_id: str) -> None:
        """批准规范"""
        binding = self._load_binding(change_id)
        binding.spec.status = 'approved'
        self._save_binding(binding)

        # 更新规范仓 meta.yaml
        self._update_spec_meta(change_id, status='approved')

    # ========== 实现操作 ==========

    def create_impl(self, spec_id: str, branch: str) -> str:
        """创建实现任务，绑定规范"""
        binding = self._load_binding(spec_id)

        # 检查规范状态
        if binding.spec.status != 'approved':
            raise Exception(f"Spec {spec_id} not approved (status: {binding.spec.status})")

        # 在业务仓创建任务
        task_id = multica.create_task(
            project=self.impl_project['name'],
            title=f"Implement {spec_id}",
            mode='worktree',
            branch=branch
        )

        # 创建 worktree
        worktree_path = Path(self.impl_project['path']) / '.multica/workspaces' / self.workspace / f'wt-{spec_id}'
        worktree_path.parent.mkdir(parents=True, exist_ok=True)
        multica.create_worktree(
            repo=self.impl_project['path'],
            path=worktree_path,
            branch=branch
        )

        # 同步规范到缓存
        self._sync_spec_to_cache(spec_id)

        # 更新绑定
        binding.impl = ImplBinding(
            project=self.impl_project['name'],
            task_id=task_id,
            branch=branch,
            worktree=str(worktree_path),
            status='pending'
        )
        self._save_binding(binding)

        return task_id

    # ========== 状态查询 ==========

    def get_status(self) -> list:
        """获取跨项目状态"""
        bindings = self._load_all_bindings()

        status_list = []
        for binding in bindings:
            status_list.append({
                'change_id': binding.change_id,
                'spec_status': binding.spec.status,
                'spec_version': binding.spec.version,
                'impl_status': binding.impl.status if binding.impl else '-',
                'impl_task': binding.impl.task_id if binding.impl else '-'
            })

        return status_list

    # ========== 辅助方法 ==========

    def _create_spec_templates(self, spec_dir: Path, title: str):
        """创建规范模板文件"""
        # proposal.md
        proposal = f"""---
id: {spec_dir.name}
title: {title}
status: proposal
created_at: {datetime.now().isoformat()}
---

# {title}

## 背景

[描述变更背景]

## 目标

[描述变更目标]

## 方案

[描述具体方案]
"""
        (spec_dir / 'proposal.md').write_text(proposal)

        # tasks.md
        tasks = f"""# 任务清单

- [ ] 任务 1
- [ ] 任务 2
- [ ] 任务 3
"""
        (spec_dir / 'tasks.md').write_text(tasks)

        # meta.yaml
        meta = f"""id: {spec_dir.name}
status: proposal
version: 1
sync:
  implementations: []
"""
        (spec_dir / 'meta.yaml').write_text(meta)

    def _sync_spec_to_cache(self, change_id: str):
        """同步规范到业务仓缓存"""
        spec_source = Path(self.spec_project['path']) / 'openspec/changes' / change_id
        cache_dir = Path(self.impl_project['path']) / '.multica/spec-cache' / change_id

        if cache_dir.exists():
            shutil.rmtree(cache_dir)

        shutil.copytree(spec_source, cache_dir)

        # 设置只读
        for file in cache_dir.rglob('*'):
            if file.is_file():
                os.chmod(file, 0o444)

    def _save_binding(self, binding: Binding):
        """保存绑定关系"""
        self.links_dir.mkdir(parents=True, exist_ok=True)
        binding_file = self.links_dir / f'{binding.change_id}.json'

        data = {
            'change_id': binding.change_id,
            'spec': binding.spec.__dict__,
            'impl': binding.impl.__dict__ if binding.impl else None
        }

        binding_file.write_text(json.dumps(data, indent=2))

    def _load_binding(self, change_id: str) -> Binding:
        """加载绑定关系"""
        binding_file = self.links_dir / f'{change_id}.json'
        data = json.loads(binding_file.read_text())

        return Binding(
            change_id=data['change_id'],
            spec=SpecBinding(**data['spec']),
            impl=ImplBinding(**data['impl']) if data['impl'] else None
        )

    def _load_all_bindings(self) -> list:
        """加载所有绑定关系"""
        bindings = []
        for file in self.links_dir.glob('*.json'):
            data = json.loads(file.read_text())
            bindings.append(Binding(
                change_id=data['change_id'],
                spec=SpecBinding(**data['spec']),
                impl=ImplBinding(**data['impl']) if data['impl'] else None
            ))
        return bindings

    def _update_spec_meta(self, change_id: str, status: str):
        """更新规范仓 meta.yaml"""
        meta_file = Path(self.spec_project['path']) / 'openspec/changes' / change_id / 'meta.yaml'
        meta = yaml.safe_load(meta_file.read_text())
        meta['status'] = status
        meta['updated_at'] = datetime.now().isoformat()
        meta_file.write_text(yaml.dump(meta, default_flow_style=False))

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 规范漂移 | 中 | 高 | 版本锁定、自动检测 |
| 同步延迟 | 低 | 中 | 混合模式、监控告警 |
| 冲突频繁 | 中 | 中 | 自动化解决、人工兜底 |
| 权限复杂 | 低 | 低 | 统一认证、RBAC |

---


---

## 12. 附录

### 12.1 术语表

| 术语 | 定义 |
|------|------|
| OpenSpec | 规范驱动的开发方法论 |
| Multica | 多 Agent 协作开发平台 |
| inplace 模式 | 直接在项目目录工作，串行执行 |
| worktree 模式 | 在隔离的 Git worktree 中工作，支持并行 |
| 目录锁 | Multica 防止并发修改同一目录的机制 |
| Workspace | 用户工作区，绑定规范仓和业务仓 |
| 工作区绑定 | Workspace 与双仓项目的关联关系 |
| 规范源 | openspec-central，规范的 authoritative source |
| 实现消费方 | business-workspace，消费规范并产出代码 |

### 12.2 参考资料

- Multica 文档: https://docs.multica.dev
- OpenSpec 规范: https://openspec.dev
- Git Worktree: https://git-scm.com/docs/git-worktree

---

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-11-02 | 初始版本 |
| v1.1 | 2026-11-02 | 新增第12章：工作区绑定（Workspace Binding） |
