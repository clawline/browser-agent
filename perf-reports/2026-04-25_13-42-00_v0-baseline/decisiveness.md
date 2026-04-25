# 决策果断性专项 (S8 + S2 旁证)

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


## S2 旁证 (ref vs 坐标路径下的犹豫)

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

## S8 详细

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
