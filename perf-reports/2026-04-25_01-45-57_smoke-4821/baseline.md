# browser-agent baseline 性能报告

- 时间: 2026-04-25T01:45:56.329Z
- HOOK_URL: http://127.0.0.1:4821/hook
- N (起点): 1, 长尾自动扩展: 30
- sessions: [{"windowId":420609637}]
- chromeConnected: true
- server-side timing: **未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)

## 总览（端到端 RTT + 工具开销）

| ID | 维度 | n | 成功率 | RTT p50 | RTT p95 | avg tools | redundant | 备注 |
|---|---|---|---|---|---|---|---|---|
| S1 | baseline | 1 | 100% | 796ms | 796ms | 0 | 0 |  |

## 各场景明细

### S1 — 导航 + DOM 抓取基线

- 维度: `baseline`
- 理论最小 tool 调用: 3
- N: 1, 成功: 1, 成功率: 100.0%
- **RTT**: p50=**796ms**, p95=**796ms**, avg=796ms, min=796ms, max=796ms
- 工具调用 (avg): total=0, read_page=0, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0

## 注释

- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。
- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。
- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。
- 长尾扩展条件: 初始 N=1 内 p95/p50 > 3 时自动加跑到 30。
