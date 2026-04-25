# 决策果断性专项 (S8 + S2 旁证)

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


## S2 旁证 (ref vs 坐标路径下的犹豫)

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

## S8 详细

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
