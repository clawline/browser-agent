# browser-agent baseline 性能报告

- 时间: 2026-04-26T01:00:01.311Z
- HOOK_URL: http://127.0.0.1:4821/hook
- N (起点): 5, 长尾自动扩展: 30
- sessions: [{"windowId":420611949,"focused":true,"windowType":"normal","incognito":false,"tabCount":24,"tabs":[{"id":420611962,"title":"Visual Studio Code 1.117","url":"https://code.visualstudio.com/updates/v1_117","active":true,"pinned":false,"discarded":false},{"id":420612184,"title":"扩展程序","url":"chrome://extensions/","active":false,"pinned":false,"discarded":false},{"id":420612116,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612117,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612118,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612119,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612120,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612121,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612122,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612123,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612124,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612185,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612186,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612187,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612188,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612189,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612190,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612191,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612192,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612193,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612194,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612195,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612196,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612197,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false}],"activeTab":{"id":420611962,"title":"Visual Studio Code 1.117","url":"https://code.visualstudio.com/updates/v1_117"}}]
- chromeConnected: true
- server-side timing: **未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)

## 总览（端到端 RTT + 工具开销 + 校验通过）

| ID | 分类 | n | 成功率 | 校验通过 | avg score | RTT p50 | RTT p95 | avg tools | redundant |
|---|---|---|---|---|---|---|---|---|---|
| W2 | extraction | 5 | 100% | 5/5 (100%) | 0.98 | 21091ms | 81058ms | 8 | 4.4 |
| W4 | extraction | 5 | 60% | 2/3 (67%) | 0.93 | 22943ms | 56091ms | 7.67 | 3.67 |
| W6 | manipulation | 5 | 100% | 5/5 (100%) | 1 | 79297ms | 117221ms | 21.4 | 12.4 |
| W7 | manipulation | 5 | 100% | 5/5 (100%) | 1 | 46069ms | 84627ms | 12.2 | 3.4 |
| W11 | workflow | 5 | 80% | 3/4 (75%) | 0.75 | 54160ms | 61652ms | 10.75 | 2.75 |
| W15 | workflow | 5 | 0% | — | — | 0ms | 0ms | 0 | 0 |

## 分类汇总

| 分类 | 场景数 | 总运行数 | 校验通过 | 平均 score | 平均 p50 RTT | 平均 tools |
|---|---|---|---|---|---|---|
| extraction | 2 | 10 | 7/8 (88%) | 0.96 | 22017ms | 7.84 |
| manipulation | 2 | 10 | 10/10 (100%) | 1 | 62683ms | 16.8 |
| workflow | 2 | 10 | 3/4 (75%) | 0.75 | 27080ms | 5.38 |

## 各场景明细

### W2 — 抽取 — GitHub repo 元数据

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 5, 成功: 5, 成功率: 100.0%
- **Validator**: passed 5/5 (100%), avg score=0.98
- **RTT**: p50=**21091ms**, p95=**81058ms**, avg=37018ms, min=12146ms, max=81058ms
- 工具调用 (avg): total=8, read_page=2, screenshot=2.2, find=0.4, click=0.2, form_input=0
- **冗余调用** (avg): 4.4  |  **click 前重复确认** (avg): 0.2
- 重复 read_page 的运行占比: 60.0%  |  含 screenshot 的运行占比: 60.0%
- 工具错误总数: 0
### W4 — 抽取 — Google 搜索结果（过滤广告）

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 5, 成功: 3, 成功率: 60.0%
- **Validator**: passed 2/3 (67%), avg score=0.93
- **RTT**: p50=**22943ms**, p95=**56091ms**, avg=32773ms, min=19284ms, max=56091ms
- 工具调用 (avg): total=7.67, read_page=1.33, screenshot=1, find=0, click=0, form_input=0
- **冗余调用** (avg): 3.67  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 33.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W6 — 操控 — 多 tab 编排

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 9
- N: 5, 成功: 5, 成功率: 100.0%
- **Validator**: passed 5/5 (100%), avg score=1
- **RTT**: p50=**79297ms**, p95=**117221ms**, avg=81282ms, min=41234ms, max=117221ms
- 工具调用 (avg): total=21.4, read_page=0.6, screenshot=1.4, find=0, click=1, form_input=0
- **冗余调用** (avg): 12.4  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 60.0%
- 工具错误总数: 0
### W7 — 操控 — HN 多分区切换

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 9
- N: 5, 成功: 5, 成功率: 100.0%
- **Validator**: passed 5/5 (100%), avg score=1
- **RTT**: p50=**46069ms**, p95=**84627ms**, avg=52001ms, min=34825ms, max=84627ms
- 工具调用 (avg): total=12.2, read_page=3, screenshot=4, find=0, click=2.8, form_input=0
- **冗余调用** (avg): 3.4  |  **click 前重复确认** (avg): 2.8
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W11 — 工作流 — GitHub issue 三步筛选

- 维度: `workflow`  |  分类: `workflow`
- 理论最小 tool 调用: 8
- N: 5, 成功: 4, 成功率: 80.0%
- **Validator**: passed 3/4 (75%), avg score=0.75
- **RTT**: p50=**54160ms**, p95=**61652ms**, avg=45568ms, min=29582ms, max=61652ms
- 工具调用 (avg): total=10.75, read_page=1, screenshot=3.75, find=0.25, click=0, form_input=0
- **冗余调用** (avg): 2.75  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 25.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W15 — 一次性 — GitHub 多页导航 + 抽取

- 维度: `one-shot`  |  分类: `workflow`
- 理论最小 tool 调用: 8
- N: 5, 成功: 0, 成功率: 0.0%
- **RTT**: p50=**0ms**, p95=**0ms**, avg=0ms, min=0ms, max=0ms
- 工具调用 (avg): total=0, read_page=0, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0

## 注释

- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。
- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。
- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。
- 长尾扩展条件: 初始 N=5 内 p95/p50 > 3 时自动加跑到 30。
