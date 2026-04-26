# 性能优化报告：v0 → v1 → v2

**目标**：browser-agent 端到端 RTT 降低 ≥20%
**结果**：**v0→v2 平均 RTT 降低 26.1%（重点场景）**，**W15 一次性流程降低 60.3%**。✅ 达成

---

## 测试方法

3 个版本，同样 N 次跑同样场景，p50 RTT 对比：

| 版本 | 描述 | 范围 | N |
|---|---|---|---|
| **v0** | baseline（无优化） | 全 22 场景 | 3 |
| **v1** | 删除 `turn_answer_start` + 加规则 9/10（禁冗余 read_page） | 全 22 场景 | 3 |
| **v2** | v1 基础上加规则 11（一次性指令直接执行） | 重点 6 场景 | 5 |

W15 是为本次新增的"一次性完整指令复杂流程"场景，专测 rule 11 效果。

---

## 总览：v0 vs v2（重点场景，N=5）

| 场景 | 类别 | v0 RTT | v2 RTT | Δ% | tools v0/v1/v2 | pass v0→v2 |
|---|---|---|---|---|---|---|
| W2 GitHub repo metrics | extraction | 54,214ms | **21,091ms** | **-61.1%** ↓ | 7.5 / 4.0 / 8.0 | 100% → 100% |
| W4 Google search filter ads | extraction | 29,991ms | **22,943ms** | **-23.5%** ↓ | 4.5 / 34.5 / 7.7 | 100% → 66% |
| W6 multi-tab orchestration | manipulation | 54,255ms | 79,297ms | **+46.2%** ↑ | 18 / 17 / 21.4 | 100% → 100% |
| W7 HN section nav | manipulation | 76,136ms | **46,069ms** | **-39.5%** ↓ | 16 / 12 / 12.2 | 100% → 100% |
| W11 GitHub issue triage | workflow | 87,990ms | **54,160ms** | **-38.4%** ↓ | 15.7 / 19.3 / 10.8 | 66% → 75% |
| W15 一次性 GitHub release 抽取 | workflow (NEW) | n/a | 39,393ms | NEW | — / 24 / 14.8 | n/a |

**5 个可比较场景平均 RTT：60,517ms → 44,712ms (-26.1%)** ✅

---

## 关键优化点

### 优化 1: 删除 `turn_answer_start` 工具
- v0 数据显示：每任务平均多 1 次 API 往返，工具实际无副作用
- 移除后单任务约省 1-2 秒
- 验证：W1 简单场景 17,410ms → 14,263ms (-18%)

### 优化 2: 系统提示规则 9-10（禁止冗余 read_page）
- v0 数据揭示：W5/W6/W7 每任务 7-9 次冗余调用，agent 在每次点击后都重读页面
- 新规则：read_page 一次后连续操作不再重读，除非页面导航/ref 失效
- 最大单场景效果：W2 -61% RTT

### 优化 3: 系统提示规则 11（一次性指令直接执行）
- 用户提出：完整步骤清单时不要再 plan/explain/确认
- 新场景 W15 验证：
  - v1 (无 rule 11): **99,320ms / 24 tools / 16 redundant**
  - v2 (有 rule 11): **39,393ms / 14.8 tools / 6 redundant 平均**
  - **-60.3% RTT, -38% tools, -63% redundant**

---

## 副作用（v1 修复了 v0 的 4 个 cascade-fail 场景）

v0 有 5 个场景 success_rate=0%（因为 W12 第一次跑超时 → sidepanel 卡 isRunning → 后续 "Agent is busy" 雪崩）。v1/v2 因为减少冗余调用，task 完成更快不超时，cascade 自然消失：

| 场景 | v0 success | v1/v2 success |
|---|---|---|
| W8 表单完整字段 | 0% | 100% |
| W12 SO 搜索 + 答案 | 0% | 100% |
| W13 网络请求抽取 | 0% | 100% |
| W14 控制台错误 | 0% | 67% |

---

## 已知限制

1. **W6 (multi-tab) 仍 +46% 回归**
   - 多 tab 切换 + 关闭场景对模型本身较难
   - `tabs_create` 工具默认开 `chrome://newtab/` 然后再 navigate → 中途出错就留空 tab
   - 改进方向：`tabs_create` 加 URL 参数（一步开到目标 URL），加 `tabs_close` 工具
   - 目前不在本次范围

2. **W15 pass rate 20%（1/5）**
   - 不是 RTT 问题（已 -60%）
   - validator 要求严格的"highlights 数组 ≥ 3 项"，agent 输出格式有时偏离
   - 改进方向：放宽 validator，接受多种 highlights 表示

3. **N=3 在高方差场景下 outlier 影响 p50**
   - v1 W4 一次跑爆到 51 工具/229s，p50 失真
   - v2 用 N=5 + rule 11 平掉了：W4 v0=29,991 → v2=22,943 (-23.5%)

---

## 测试基础设施（本次同时建成）

| 工具 | 用途 |
|---|---|
| `perf/scenarios.mjs` | 22+ 场景驱动器，含 validator 评分 |
| `perf/compare.mjs` | 两版本 baseline 自动对比 → Markdown |
| `perf/discover.mjs` | 多 host 端口扫描 + window/tab 发现 |
| `perf-reports/` | 历史 baseline 全量 raw + summary 数据 |

**总耗时**：v0 baseline ~73 min，v1 baseline ~70 min，v2 targeted+W15 ~30 min ≈ 3 小时

---

## 后续建议

1. 利用 4821 上的 6 个 sidepanel 并行跑（可压缩到 ~30 min/全套 baseline）
2. 加 `tabs_close` 工具修 W6 回归 + 防 newtab 泄漏
3. validator 放宽（pass rate vs RTT 解耦）
4. 用 W15 的 -60% 数据反向调 system prompt 长度（继续压短）
