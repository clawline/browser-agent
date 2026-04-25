# browser-agent baseline 性能报告

- 时间: 2026-04-25T12:29:38.941Z
- HOOK_URL: http://127.0.0.1:4821/hook
- N (起点): 3, 长尾自动扩展: 30
- sessions: [{"windowId":420611949,"focused":false,"windowType":"normal","incognito":false,"tabCount":2,"tabs":[{"id":420611962,"title":"Hacker News","url":"https://news.ycombinator.com/","active":true,"pinned":false,"discarded":false},{"id":420612034,"title":"扩展程序","url":"chrome://extensions/","active":false,"pinned":false,"discarded":false}],"activeTab":{"id":420611962,"title":"Hacker News","url":"https://news.ycombinator.com/"}}]
- chromeConnected: true
- server-side timing: **未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)

## 总览（端到端 RTT + 工具开销 + 校验通过）

| ID | 分类 | n | 成功率 | 校验通过 | avg score | RTT p50 | RTT p95 | avg tools | redundant |
|---|---|---|---|---|---|---|---|---|---|
| S1 | atomic | 3 | 100% | — | — | 6884ms | 7865ms | 2 | 0 |
| S2A | atomic | 3 | 100% | — | — | 14803ms | 18840ms | 4 | 0 |
| S2B | atomic | 3 | 100% | — | — | 16113ms | 17711ms | 3.67 | 0 |
| S4 | atomic | 3 | 100% | — | — | 11346ms | 12232ms | 3 | 0 |
| S5 | atomic | 3 | 100% | — | — | 15937ms | 23075ms | 6.33 | 0 |
| S8-T1 | decisiveness | 30 | 100% | — | — | 10614ms | 85051ms | 6.7 | 4.13 |
| S8-T2 | decisiveness | 3 | 100% | — | — | 32485ms | 37185ms | 5.67 | 1.67 |
| S8-T3 | decisiveness | 3 | 100% | — | — | 18427ms | 20495ms | 4.67 | 0.67 |
| W1 | extraction | 3 | 100% | 3/3 (100%) | 1 | 17410ms | 17567ms | 3 | 0 |
| W2 | extraction | 3 | 67% | 2/2 (100%) | 0.9 | 54214ms | 54214ms | 7.5 | 3.5 |
| W3 | extraction | 3 | 100% | 3/3 (100%) | 1 | 27995ms | 28826ms | 5.33 | 1.33 |
| W4 | extraction | 3 | 67% | 2/2 (100%) | 1 | 29991ms | 29991ms | 4.5 | 0.5 |
| W5 | manipulation | 3 | 67% | 2/2 (100%) | 1 | 73658ms | 73658ms | 23.5 | 7.5 |
| W6 | manipulation | 3 | 100% | 3/3 (100%) | 1 | 54255ms | 99927ms | 18 | 9 |
| W7 | manipulation | 3 | 100% | 3/3 (100%) | 1 | 76136ms | 85299ms | 16 | 7 |
| W8 | forms | 3 | 0% | — | — | 0ms | 0ms | 0 | 0 |
| W9 | forms | 3 | 100% | 2/3 (67%) | 0.9 | 63493ms | 83521ms | 15 | 7 |
| W10 | forms | 3 | 0% | — | — | 0ms | 0ms | 0 | 0 |
| W11 | workflow | 3 | 100% | 2/3 (67%) | 0.67 | 87990ms | 90304ms | 15.67 | 8.67 |
| W12 | workflow | 3 | 0% | — | — | 0ms | 0ms | 0 | 0 |
| W13 | devtools | 3 | 0% | — | — | 0ms | 0ms | 0 | 0 |
| W14 | devtools | 3 | 0% | — | — | 0ms | 0ms | 0 | 0 |

## 分类汇总

| 分类 | 场景数 | 总运行数 | 校验通过 | 平均 score | 平均 p50 RTT | 平均 tools |
|---|---|---|---|---|---|---|
| atomic | 5 | 15 | — | — | 13017ms | 3.8 |
| extraction | 4 | 12 | 10/10 (100%) | 0.98 | 32403ms | 5.08 |
| manipulation | 3 | 9 | 8/8 (100%) | 1 | 68016ms | 19.17 |
| forms | 3 | 9 | 2/3 (67%) | 0.9 | 21164ms | 5 |
| workflow | 2 | 6 | 2/3 (67%) | 0.67 | 43995ms | 7.84 |
| devtools | 2 | 6 | — | — | 0ms | 0 |
| decisiveness | 3 | 36 | — | — | 20509ms | 5.68 |

## 🔥 决策果断性高亮 (S8)

按 resley 强调，这是核心维度。所有 S8 子任务的犹豫信号汇总如下:

| 子任务 | n | 成功率 | RTT p50 | avg total tools | avg read_page | avg screenshot | avg redundant | click前重复确认 | 重复 read_page 运行% |
|---|---|---|---|---|---|---|---|---|---|
| S8-T1 决策果断性 — GitHub 顶部搜索 | 30 | 100% | 10614ms | 6.7 | 0.93 | 2.4 | 4.13 | 0.8 | 23% |
| S8-T2 决策果断性 — Google Gmail 链接 | 3 | 100% | 32485ms | 5.67 | 1 | 2.33 | 1.67 | 1 | 0% |
| S8-T3 决策果断性 — HN 第3条评论链接 | 3 | 100% | 18427ms | 4.67 | 1 | 1.33 | 0.67 | 1 | 0% |

**预警阈值** (resley 提的):
- 冗余调用 > 3 → 偏离最优路径
- 任一子任务首次命中率 < 80% → 决策不准
- ≥ 2 次连续 read_page → 视觉再确认 / 犹豫

## 各场景明细

### S1 — 导航 + DOM 抓取基线

- 维度: `baseline`  |  分类: `atomic`
- 理论最小 tool 调用: 3
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**6884ms**, p95=**7865ms**, avg=6458ms, min=4627ms, max=7865ms
- 工具调用 (avg): total=2, read_page=1, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S2A — 点击延迟 — ref 路径

- 维度: `click-latency`  |  分类: `atomic`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**14803ms**, p95=**18840ms**, avg=16109ms, min=14684ms, max=18840ms
- 工具调用 (avg): total=4, read_page=1, screenshot=0, find=0, click=1, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### S2B — 点击延迟 — 坐标路径

- 维度: `click-latency`  |  分类: `atomic`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**16113ms**, p95=**17711ms**, avg=15731ms, min=13369ms, max=17711ms
- 工具调用 (avg): total=3.67, read_page=0, screenshot=1, find=0, click=1, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S4 — 长页面截图性能

- 维度: `screenshot`  |  分类: `atomic`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**11346ms**, p95=**12232ms**, avg=11488ms, min=10885ms, max=12232ms
- 工具调用 (avg): total=3, read_page=0, screenshot=1, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S5 — 网络监听 + 重复 read_page 稳定性

- 维度: `network+repeat`  |  分类: `atomic`
- 理论最小 tool 调用: 7
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**15937ms**, p95=**23075ms**, avg=18045ms, min=15124ms, max=23075ms
- 工具调用 (avg): total=6.33, read_page=3, screenshot=0.33, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 33.0%
- 工具错误总数: 0
### S8-T1 — 决策果断性 — GitHub 顶部搜索

- 维度: `decisiveness`  |  分类: `decisiveness`
- 理论最小 tool 调用: 5
- N: 30, 成功: 30, 成功率: 100.0%
- **RTT**: p50=**10614ms**, p95=**85051ms**, avg=28367ms, min=6302ms, max=159734ms
- 工具调用 (avg): total=6.7, read_page=0.93, screenshot=2.4, find=0.33, click=0.8, form_input=0.03
- **冗余调用** (avg): 4.13  |  **click 前重复确认** (avg): 0.8
- 重复 read_page 的运行占比: 23.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S8-T2 — 决策果断性 — Google Gmail 链接

- 维度: `decisiveness`  |  分类: `decisiveness`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**32485ms**, p95=**37185ms**, avg=28512ms, min=15866ms, max=37185ms
- 工具调用 (avg): total=5.67, read_page=1, screenshot=2.33, find=0, click=1, form_input=0
- **冗余调用** (avg): 1.67  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### S8-T3 — 决策果断性 — HN 第3条评论链接

- 维度: `decisiveness`  |  分类: `decisiveness`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **RTT**: p50=**18427ms**, p95=**20495ms**, avg=17970ms, min=14988ms, max=20495ms
- 工具调用 (avg): total=4.67, read_page=1, screenshot=1.33, find=0, click=1, form_input=0
- **冗余调用** (avg): 0.67  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W1 — 抽取 — HN 前 10 条故事 JSON

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**17410ms**, p95=**17567ms**, avg=17291ms, min=16896ms, max=17567ms
- 工具调用 (avg): total=3, read_page=1, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### W2 — 抽取 — GitHub repo 元数据

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 2, 成功率: 66.7%
- **Validator**: passed 2/2 (100%), avg score=0.9
- **RTT**: p50=**54214ms**, p95=**54214ms**, avg=41552ms, min=28890ms, max=54214ms
- 工具调用 (avg): total=7.5, read_page=2.5, screenshot=1, find=0, click=0.5, form_input=0
- **冗余调用** (avg): 3.5  |  **click 前重复确认** (avg): 0.5
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W3 — 抽取 — Wikipedia infobox

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**27995ms**, p95=**28826ms**, avg=25659ms, min=20156ms, max=28826ms
- 工具调用 (avg): total=5.33, read_page=1.33, screenshot=1, find=0, click=0, form_input=0
- **冗余调用** (avg): 1.33  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 33.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W4 — 抽取 — Google 搜索结果（过滤广告）

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 3, 成功: 2, 成功率: 66.7%
- **Validator**: passed 2/2 (100%), avg score=1
- **RTT**: p50=**29991ms**, p95=**29991ms**, avg=24159ms, min=18328ms, max=29991ms
- 工具调用 (avg): total=4.5, read_page=1, screenshot=0.5, find=0, click=0, form_input=0
- **冗余调用** (avg): 0.5  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 50.0%
- 工具错误总数: 0
### W5 — 操控 — TodoMVC 完整流程

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 16
- N: 3, 成功: 2, 成功率: 66.7%
- **Validator**: passed 2/2 (100%), avg score=1
- **RTT**: p50=**73658ms**, p95=**73658ms**, avg=72595ms, min=71532ms, max=73658ms
- 工具调用 (avg): total=23.5, read_page=4, screenshot=4, find=0, click=4, form_input=0
- **冗余调用** (avg): 7.5  |  **click 前重复确认** (avg): 3
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W6 — 操控 — 多 tab 编排

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 9
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**54255ms**, p95=**99927ms**, avg=69350ms, min=53869ms, max=99927ms
- 工具调用 (avg): total=18, read_page=1, screenshot=1, find=0, click=0.67, form_input=0
- **冗余调用** (avg): 9  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 67.0%
- 工具错误总数: 0
### W7 — 操控 — HN 多分区切换

- 维度: `manipulation`  |  分类: `manipulation`
- 理论最小 tool 调用: 9
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 3/3 (100%), avg score=1
- **RTT**: p50=**76136ms**, p95=**85299ms**, avg=70587ms, min=50325ms, max=85299ms
- 工具调用 (avg): total=16, read_page=3.33, screenshot=6, find=0.33, click=3.33, form_input=0
- **冗余调用** (avg): 7  |  **click 前重复确认** (avg): 3.33
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W8 — 表单 — httpbin 完整字段

- 维度: `forms`  |  分类: `forms`
- 理论最小 tool 调用: 6
- N: 3, 成功: 0, 成功率: 0.0%
- **RTT**: p50=**0ms**, p95=**0ms**, avg=0ms, min=0ms, max=0ms
- 工具调用 (avg): total=0, read_page=0, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### W9 — 表单 — 下拉/单选/多选混合

- 维度: `forms`  |  分类: `forms`
- 理论最小 tool 调用: 8
- N: 3, 成功: 3, 成功率: 100.0%
- **Validator**: passed 2/3 (67%), avg score=0.9
- **RTT**: p50=**63493ms**, p95=**83521ms**, avg=69455ms, min=61352ms, max=83521ms
- 工具调用 (avg): total=15, read_page=1.67, screenshot=3.67, find=1, click=1, form_input=0
- **冗余调用** (avg): 7  |  **click 前重复确认** (avg): 1
- 重复 read_page 的运行占比: 67.0%  |  含 screenshot 的运行占比: 100.0%
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
- **RTT**: p50=**87990ms**, p95=**90304ms**, avg=67856ms, min=25275ms, max=90304ms
- 工具调用 (avg): total=15.67, read_page=1.33, screenshot=6.33, find=0, click=1.33, form_input=0
- **冗余调用** (avg): 8.67  |  **click 前重复确认** (avg): 1.33
- 重复 read_page 的运行占比: 67.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0
### W12 — 工作流 — Stack Overflow 搜索 + 答案抽取

- 维度: `workflow`  |  分类: `workflow`
- 理论最小 tool 调用: 7
- N: 3, 成功: 0, 成功率: 0.0%
- **RTT**: p50=**0ms**, p95=**0ms**, avg=0ms, min=0ms, max=0ms
- 工具调用 (avg): total=0, read_page=0, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### W13 — Devtools — 网络请求抽取

- 维度: `devtools`  |  分类: `devtools`
- 理论最小 tool 调用: 5
- N: 3, 成功: 0, 成功率: 0.0%
- **RTT**: p50=**0ms**, p95=**0ms**, avg=0ms, min=0ms, max=0ms
- 工具调用 (avg): total=0, read_page=0, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0
### W14 — Devtools — 控制台错误抓取

- 维度: `devtools`  |  分类: `devtools`
- 理论最小 tool 调用: 5
- N: 3, 成功: 0, 成功率: 0.0%
- **RTT**: p50=**0ms**, p95=**0ms**, avg=0ms, min=0ms, max=0ms
- 工具调用 (avg): total=0, read_page=0, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0

## 注释

- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。
- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。
- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。
- 长尾扩展条件: 初始 N=3 内 p95/p50 > 3 时自动加跑到 30。
