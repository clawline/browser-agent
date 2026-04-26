# 决策果断性专项 (S8 + S2 旁证)

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


## S2 旁证 (ref vs 坐标路径下的犹豫)

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

## S8 详细

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
