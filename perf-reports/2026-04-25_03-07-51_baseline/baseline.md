# browser-agent baseline 性能报告

- 时间: 2026-04-25T02:29:47.345Z
- HOOK_URL: http://127.0.0.1:4821/hook
- N (起点): 10, 长尾自动扩展: 30
- sessions: [{"windowId":420610935}]
- chromeConnected: true
- server-side timing: **未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)

## 总览（端到端 RTT + 工具开销）

| ID | 维度 | n | 成功率 | RTT p50 | RTT p95 | avg tools | redundant | 备注 |
|---|---|---|---|---|---|---|---|---|
| S1 | baseline | 10 | 100% | 6012ms | 10160ms | 2.1 | 0 |  |
| S2A | click-latency | 10 | 100% | 12589ms | 16124ms | 3.7 | 0 |  |
| S2B | click-latency | 10 | 100% | 15593ms | 17863ms | 3.8 | 0 |  |
| S3 | form-throughput | 10 | 100% | 9484ms | 10449ms | 6.1 | 0 |  |
| S4 | screenshot | 10 | 100% | 10600ms | 14424ms | 3.1 | 0 |  |
| S5 | network+repeat | 10 | 100% | 12714ms | 15343ms | 6.2 | 0 |  |
| S8-T1 | decisiveness | 30 | 100% | 25437ms | 88530ms | 8.23 | 4.27 | 决策维度 |
| S8-T2 | decisiveness | 10 | 100% | 21890ms | 30809ms | 5.4 | 1.4 | 决策维度 |
| S8-T3 | decisiveness | 10 | 80% | 15875ms | 28809ms | 4.13 | 0.88 | 决策维度 |

## 🔥 决策果断性高亮 (S8)

按 resley 强调，这是核心维度。所有 S8 子任务的犹豫信号汇总如下:

| 子任务 | n | 成功率 | RTT p50 | avg total tools | avg read_page | avg screenshot | avg redundant | click前重复确认 | 重复 read_page 运行% |
|---|---|---|---|---|---|---|---|---|---|
| S8-T1 决策果断性 — GitHub 顶部搜索 | 30 | 100% | 25437ms | 8.23 | 1.13 | 2.53 | 4.27 | 1.3 | 30% |
| S8-T2 决策果断性 — Google Gmail 链接 | 10 | 100% | 21890ms | 5.4 | 1 | 1.9 | 1.4 | 1 | 0% |
| S8-T3 决策果断性 — HN 第3条评论链接 | 10 | 80% | 15875ms | 4.13 | 0.88 | 1.25 | 0.88 | 0.88 | 0% |

**预警阈值** (resley 提的):
- 冗余调用 > 3 → 偏离最优路径
- 任一子任务首次命中率 < 80% → 决策不准
- ≥ 2 次连续 read_page → 视觉再确认 / 犹豫

## 各场景明细

### S1 — 导航 + DOM 抓取基线

- 维度: `baseline`
- 理论最小 tool 调用: 3
- N: 10, 成功: 10, 成功率: 100.0%
- **RTT**: p50=**6012ms**, p95=**10160ms**, avg=6231ms, min=5242ms, max=10160ms
- 工具调用 (avg): total=2.1, read_page=1, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S2A — 点击延迟 — ref 路径

- 维度: `click-latency`
- 理论最小 tool 调用: 4
- N: 10, 成功: 10, 成功率: 100.0%
- **RTT**: p50=**12589ms**, p95=**16124ms**, avg=13072ms, min=10817ms, max=16124ms
- 工具调用 (avg): total=3.7, read_page=1, screenshot=0, find=0, click=1, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S2B — 点击延迟 — 坐标路径

- 维度: `click-latency`
- 理论最小 tool 调用: 4
- N: 10, 成功: 10, 成功率: 100.0%
- **RTT**: p50=**15593ms**, p95=**17863ms**, avg=15249ms, min=11946ms, max=17863ms
- 工具调用 (avg): total=3.8, read_page=0, screenshot=1, find=0, click=1, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S3 — 表单填写吞吐

- 维度: `form-throughput`
- 理论最小 tool 调用: 7
- N: 10, 成功: 10, 成功率: 100.0%
- **RTT**: p50=**9484ms**, p95=**10449ms**, avg=9423ms, min=8384ms, max=10449ms
- 工具调用 (avg): total=6.1, read_page=1, screenshot=0, find=0, click=0, form_input=4
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S4 — 长页面截图性能

- 维度: `screenshot`
- 理论最小 tool 调用: 4
- N: 10, 成功: 10, 成功率: 100.0%
- **RTT**: p50=**10600ms**, p95=**14424ms**, avg=10761ms, min=7075ms, max=14424ms
- 工具调用 (avg): total=3.1, read_page=0, screenshot=1.1, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S5 — 网络监听 + 重复 read_page 稳定性

- 维度: `network+repeat`
- 理论最小 tool 调用: 7
- N: 10, 成功: 10, 成功率: 100.0%
- **RTT**: p50=**12714ms**, p95=**15343ms**, avg=12897ms, min=11690ms, max=15343ms
- 工具调用 (avg): total=6.2, read_page=3, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S8-T1 — 决策果断性 — GitHub 顶部搜索

- 维度: `decisiveness`
- 理论最小 tool 调用: 5
- N: 30, 成功: 30, 成功率: 100.0%
- **RTT**: p50=**25437ms**, p95=**88530ms**, avg=33029ms, min=6392ms, max=113427ms
- 工具调用 (avg): total=8.23, read_page=1.13, screenshot=2.53, find=0.57, click=1.3, form_input=0
- **冗余调用** (avg): 4.27  |  **click 前重复确认** (avg): 1.3
- 重复 read_page 的运行占比: 30.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S8-T2 — 决策果断性 — Google Gmail 链接

- 维度: `decisiveness`
- 理论最小 tool 调用: 4
- N: 10, 成功: 10, 成功率: 100.0%
- **RTT**: p50=**21890ms**, p95=**30809ms**, avg=23146ms, min=18267ms, max=30809ms
- 工具调用 (avg): total=5.4, read_page=1, screenshot=1.9, find=0.5, click=1, form_input=0
- **冗余调用** (avg): 1.4  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S8-T3 — 决策果断性 — HN 第3条评论链接

- 维度: `decisiveness`
- 理论最小 tool 调用: 4
- N: 10, 成功: 8, 成功率: 80.0%
- **RTT**: p50=**15875ms**, p95=**28809ms**, avg=15885ms, min=2893ms, max=28809ms
- 工具调用 (avg): total=4.13, read_page=0.88, screenshot=1.25, find=0, click=0.88, form_input=0
- **冗余调用** (avg): 0.88  |  **click 前重复确认** (avg): 0.88
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 63.0%
- 工具错误总数: 0
### S6 — Reconnect 抖动 (manual)

- 维度: `reconnect`
- 步骤记录: 
  - baseline: {"step":"baseline","ok":true}
  - pkill: {"step":"pkill","code":0}
  - down_confirmed: {"step":"down_confirmed","ok":true,"down_after_ms":81}
  - recovery: {"step":"recovery","recovered_ms":2091,"attempts":5,"failures":4}
  - sessions_after_recovery: {"step":"sessions_after_recovery","sessions":[]}
- **恢复时间**: 2091ms
- 失败请求次数: 4
- 总尝试次数: 5
### S7 — 多 window 并发分发

- **跳过**: only 0 sidepanel(s)

## 注释

- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。
- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。
- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。
- 长尾扩展条件: 初始 N=10 内 p95/p50 > 3 时自动加跑到 30。
