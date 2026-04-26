# browser-agent baseline 性能报告

- 时间: 2026-04-25T23:46:15.331Z
- HOOK_URL: http://127.0.0.1:4821/hook
- N (起点): 3, 长尾自动扩展: 30
- sessions: [{"windowId":420611949,"focused":false,"windowType":"normal","incognito":false,"tabCount":12,"tabs":[{"id":420611962,"title":"Hacker News","url":"https://news.ycombinator.com/","active":true,"pinned":false,"discarded":false},{"id":420612184,"title":"扩展程序","url":"chrome://extensions/","active":false,"pinned":false,"discarded":false},{"id":420612116,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612117,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612118,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612119,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612120,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612121,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612122,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612123,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612124,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612185,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false}],"activeTab":{"id":420611962,"title":"Hacker News","url":"https://news.ycombinator.com/"}}]
- chromeConnected: true
- server-side timing: **未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)

## 总览（端到端 RTT + 工具开销 + 校验通过）

| ID | 分类 | n | 成功率 | 校验通过 | avg score | RTT p50 | RTT p95 | avg tools | redundant |
|---|---|---|---|---|---|---|---|---|---|
| S1 | atomic | 3 | 100% | — | — | 7078ms | 7139ms | 2 | 0 |
| S2A | atomic | 3 | 100% | — | — | 10913ms | 12550ms | 3 | 0 |
| S2B | atomic | 3 | 100% | — | — | 12220ms | 13067ms | 3 | 0 |
| S4 | atomic | 3 | 100% | — | — | 11661ms | 16747ms | 3.33 | 0 |
| S5 | atomic | 3 | 100% | — | — | 13807ms | 13870ms | 6 | 0 |
| S8-T1 | decisiveness | 30 | 53% | — | — | 7508ms | 56036ms | 4.44 | 2.06 |
| S8-T2 | decisiveness | 3 | 100% | — | — | 28028ms | 30707ms | 5.67 | 1.67 |
| S8-T3 | decisiveness | 3 | 100% | — | — | 22569ms | 22612ms | 4.33 | 0.67 |
| W1 | extraction | 3 | 100% | 3/3 (100%) | 1 | 16081ms | 136378ms | 11.67 | 8.67 |
| W2 | extraction | 3 | 67% | 2/2 (100%) | 0.98 | 21738ms | 21738ms | 4 | 0.5 |
| W3 | extraction | 3 | 100% | 3/3 (100%) | 1 | 30134ms | 35644ms | 6.67 | 2.67 |
| W4 | extraction | 3 | 67% | 2/2 (100%) | 1 | 229304ms | 229304ms | 34.5 | 30.5 |
| W5 | manipulation | 3 | 100% | 3/3 (100%) | 1 | 63870ms | 64389ms | 21.67 | 5.67 |
| W6 | manipulation | 3 | 67% | 2/2 (100%) | 1 | 94685ms | 94685ms | 17 | 8 |
| W7 | manipulation | 3 | 100% | 3/3 (100%) | 1 | 47922ms | 77141ms | 12 | 3 |
| W8 | forms | 3 | 33% | 1/1 (100%) | 1 | 20453ms | 20453ms | 5 | 0 |
| W9 | forms | 3 | 100% | 3/3 (100%) | 1 | 53563ms | 62274ms | 13.33 | 5.33 |
| W10 | forms | 3 | 0% | — | — | 0ms | 0ms | 0 | 0 |
| W11 | workflow | 3 | 100% | 2/3 (67%) | 0.67 | 56244ms | 142400ms | 19.33 | 11.33 |
| W12 | workflow | 3 | 100% | 3/3 (100%) | 1 | 89918ms | 140985ms | 19 | 12 |
| W13 | devtools | 3 | 100% | 3/3 (100%) | 1 | 37870ms | 64280ms | 11.67 | 6.67 |
| W14 | devtools | 3 | 100% | 2/3 (67%) | 0.8 | 25812ms | 29271ms | 8.33 | 3.33 |

## 分类汇总

| 分类 | 场景数 | 总运行数 | 校验通过 | 平均 score | 平均 p50 RTT | 平均 tools |
|---|---|---|---|---|---|---|
| atomic | 5 | 15 | — | — | 11136ms | 3.47 |
| extraction | 4 | 12 | 10/10 (100%) | 1 | 74314ms | 14.21 |
| manipulation | 3 | 9 | 8/8 (100%) | 1 | 68826ms | 16.89 |
| forms | 3 | 9 | 4/4 (100%) | 1 | 24672ms | 6.11 |
| workflow | 2 | 6 | 5/6 (83%) | 0.84 | 73081ms | 19.17 |
| devtools | 2 | 6 | 5/6 (83%) | 0.9 | 31841ms | 10 |
| decisiveness | 3 | 36 | — | — | 19368ms | 4.81 |

## 🔥 决策果断性高亮 (S8)

按 resley 强调，这是核心维度。所有 S8 子任务的犹豫信号汇总如下:

| 子任务 | n | 成功率 | RTT p50 | avg total tools | avg read_page | avg screenshot | avg redundant | click前重复确认 | 重复 read_page 运行% |
|---|---|---|---|---|---|---|---|---|---|
| S8-T1 决策果断性 — GitHub 顶部搜索 | 30 | 53% | 7508ms | 4.44 | 0.75 | 1.25 | 2.06 | 0.81 | 19% |
| S8-T2 决策果断性 — Google Gmail 链接 | 3 | 100% | 28028ms | 5.67 | 1 | 2.33 | 1.67 | 1 | 0% |
| S8-T3 决策果断性 — HN 第3条评论链接 | 3 | 100% | 22569ms | 4.33 | 1 | 1.33 | 0.67 | 1 | 0% |

**预警阈值** (resley 提的):
- 冗余调用 > 3 → 偏离最优路径
- 任一子任务首次命中率 < 80% → 决策不准
- ≥ 2 次连续 read_page → 视觉再确认 / 犹豫

## 各场景明细

### S1 — 导航 + DOM 抓取基线

- 维度: `baseline`  |  分类: `atomic`
- 理论最小 tool 调用: 3
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**7078ms**, p95=**7139ms**, avg=6771ms, min=6096ms, max=7139ms
- 工具调用 (avg): total=2, read_page=1, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S2A — 点击延迟 — ref 路径

- 维度: `click-latency`  |  分类: `atomic`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**10913ms**, p95=**12550ms**, avg=11421ms, min=10801ms, max=12550ms
- 工具调用 (avg): total=3, read_page=1, screenshot=0, find=0, click=1, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S2B — 点击延迟 — 坐标路径

- 维度: `click-latency`  |  分类: `atomic`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**12220ms**, p95=**13067ms**, avg=12397ms, min=11905ms, max=13067ms
- 工具调用 (avg): total=3, read_page=0, screenshot=1, find=0, click=1, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S4 — 长页面截图性能

- 维度: `screenshot`  |  分类: `atomic`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**11661ms**, p95=**16747ms**, avg=12907ms, min=10314ms, max=16747ms
- 工具调用 (avg): total=3.33, read_page=0, screenshot=1.33, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S5 — 网络监听 + 重复 read_page 稳定性

- 维度: `network+repeat`  |  分类: `atomic`
- 理论最小 tool 调用: 7
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**13807ms**, p95=**13870ms**, avg=13766ms, min=13621ms, max=13870ms
- 工具调用 (avg): total=6, read_page=3, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S8-T1 — 决策果断性 — GitHub 顶部搜索

- 维度: `decisiveness`  |  分类: `decisiveness`
- 理论最小 tool 调用: 5
- N: 30, 成功: 16, 成功率: 53.3%
- **RTT**: p50=**7508ms**, p95=**56036ms**, avg=16782ms, min=275ms, max=56036ms
- 工具调用 (avg): total=4.44, read_page=0.75, screenshot=1.25, find=0.31, click=0.81, form_input=0
- **冗余调用** (avg): 2.06  |  **click 前重复确认** (avg): 0.81
- 重复 read_page 的运行占比: 19.0%  |  含 screenshot 的运行占比: 63.0%
- 工具错误总数: 0
### S8-T2 — 决策果断性 — Google Gmail 链接

- 维度: `decisiveness`  |  分类: `decisiveness`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**28028ms**, p95=**30707ms**, avg=28094ms, min=25547ms, max=30707ms
- 工具调用 (avg): total=5.67, read_page=1, screenshot=2.33, find=0.33, click=1, form_input=0
- **冗余调用** (avg): 1.67  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S8-T3 — 决策果断性 — HN 第3条评论链接

- 维度: `decisiveness`  |  分类: `decisiveness`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**22569ms**, p95=**22612ms**, avg=18730ms, min=11009ms, max=22612ms
- 工具调用 (avg): total=4.33, read_page=1, screenshot=1.33, find=0, click=1, form_input=0
- **冗余调用** (avg): 0.67  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 67.0%
- 工具错误总数: 0
### W1 — 抽取 — HN 前 10 条故事 JSON

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**16081ms**, p95=**136378ms**, avg=55507ms, min=14062ms, max=136378ms
- 工具调用 (avg): total=11.67, read_page=1, screenshot=0.67, find=0, click=0, form_input=0
- **冗余调用** (avg): 8.67  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 33.0%
- 工具错误总数: 0
### W2 — 抽取 — GitHub repo 元数据

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 2, 成功率: 66.7%
- **Validator**: passed 2/2 (100%), avg score=0.98
- **RTT**: p50=**21738ms**, p95=**21738ms**, avg=19237ms, min=16736ms, max=21738ms
- 工具调用 (avg): total=4, read_page=1.5, screenshot=1, find=0.5, click=0, form_input=0
- **冗余调用** (avg): 0.5  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 50.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W3 — 抽取 — Wikipedia infobox

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**30134ms**, p95=**35644ms**, avg=31548ms, min=28866ms, max=35644ms
- 工具调用 (avg): total=6.67, read_page=1, screenshot=1, find=0, click=0, form_input=0
- **冗余调用** (avg): 2.67  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W4 — 抽取 — Google 搜索结果（过滤广告）

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 2, 成功率: 66.7%
- **Validator**: passed 2/2 (100%), avg score=1
- **RTT**: p50=**229304ms**, p95=**229304ms**, avg=151160ms, min=73016ms, max=229304ms
- 工具调用 (avg): total=34.5, read_page=3, screenshot=7.5, find=1, click=0, form_input=0
- **冗余调用** (avg): 30.5  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 50.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W5 — 操控 — TodoMVC 完整流程

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 16
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**63870ms**, p95=**64389ms**, avg=61873ms, min=57360ms, max=64389ms
- 工具调用 (avg): total=21.67, read_page=4, screenshot=2.67, find=0, click=4, form_input=0
- **冗余调用** (avg): 5.67  |  **click 前重复确认** (avg): 3
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W6 — 操控 — 多 tab 编排

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 9
- N: 3, 成功: 2, 成功率: 66.7%
- **Validator**: passed 2/2 (100%), avg score=1
- **RTT**: p50=**94685ms**, p95=**94685ms**, avg=65555ms, min=36424ms, max=94685ms
- 工具调用 (avg): total=17, read_page=0.5, screenshot=2, find=0, click=0, form_input=0
- **冗余调用** (avg): 8  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 50.0%
- 工具错误总数: 0
### W7 — 操控 — HN 多分区切换

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 9
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**47922ms**, p95=**77141ms**, avg=54607ms, min=38758ms, max=77141ms
- 工具调用 (avg): total=12, read_page=3.33, screenshot=4, find=0, click=3, form_input=0
- **冗余调用** (avg): 3  |  **click 前重复确认** (avg): 3
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W8 — 表单 — httpbin 完整字段

- 维度: `forms`  |  分类: `forms`
- 理论最小 tool 调用: 6
- N: 3, 成功: 1, 成功率: 33.3%
- **Validator**: passed 1/1 (100%), avg score=1
- **RTT**: p50=**20453ms**, p95=**20453ms**, avg=20453ms, min=20453ms, max=20453ms
- 工具调用 (avg): total=5, read_page=1, screenshot=2, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W9 — 表单 — 下拉/单选/多选混合

- 维度: `forms`  |  分类: `forms`
- 理论最小 tool 调用: 8
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**53563ms**, p95=**62274ms**, avg=55638ms, min=51076ms, max=62274ms
- 工具调用 (avg): total=13.33, read_page=1.33, screenshot=3.67, find=0, click=0.67, form_input=0
- **冗余调用** (avg): 5.33  |  **click 前重复确认** (avg): 0.67
- 重复 read_page 的运行占比: 33.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W10 — 表单 — 日期时间 + 校验反馈

- 维度: `forms`  |  分类: `forms`
- 理论最小 tool 调用: 9
- N: 3, 成功: 0, 成功率: 0.0%
- **RTT**: p50=**0ms**, p95=**0ms**, avg=0ms, min=0ms, max=0ms
- 工具调用 (avg): total=0, read_page=0, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### W11 — 工作流 — GitHub issue 三步筛选

- 维度: `workflow`  |  分类: `workflow`
- 理论最小 tool 调用: 8
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 2/3 (67%), avg score=0.67
- **RTT**: p50=**56244ms**, p95=**142400ms**, avg=79498ms, min=39852ms, max=142400ms
- 工具调用 (avg): total=19.33, read_page=2, screenshot=7.33, find=0.33, click=2.33, form_input=0
- **冗余调用** (avg): 11.33  |  **click 前重复确认** (avg): 2.33
- 重复 read_page 的运行占比: 33.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W12 — 工作流 — Stack Overflow 搜索 + 答案抽取

- 维度: `workflow`  |  分类: `workflow`
- 理论最小 tool 调用: 7
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**89918ms**, p95=**140985ms**, avg=97461ms, min=61480ms, max=140985ms
- 工具调用 (avg): total=19, read_page=2.67, screenshot=6.33, find=1, click=1, form_input=0
- **冗余调用** (avg): 12  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W13 — Devtools — 网络请求抽取

- 维度: `devtools`  |  分类: `devtools`
- 理论最小 tool 调用: 5
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**37870ms**, p95=**64280ms**, avg=45713ms, min=34988ms, max=64280ms
- 工具调用 (avg): total=11.67, read_page=1.67, screenshot=3.33, find=0, click=0.67, form_input=0
- **冗余调用** (avg): 6.67  |  **click 前重复确认** (avg): 0.67
- 重复 read_page 的运行占比: 67.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W14 — Devtools — 控制台错误抓取

- 维度: `devtools`  |  分类: `devtools`
- 理论最小 tool 调用: 5
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 2/3 (67%), avg score=0.8
- **RTT**: p50=**25812ms**, p95=**29271ms**, avg=25146ms, min=20356ms, max=29271ms
- 工具调用 (avg): total=8.33, read_page=0, screenshot=1, find=0, click=0, form_input=0
- **冗余调用** (avg): 3.33  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0

## 注释

- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。
- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。
- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。
- 长尾扩展条件: 初始 N=3 内 p95/p50 > 3 时自动加跑到 30。
