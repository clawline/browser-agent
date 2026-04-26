# browser-agent baseline 性能报告

- 时间: 2026-04-26T01:46:32.300Z
- HOOK_URL: http://127.0.0.1:4821/hook
- N (起点): 1, 长尾自动扩展: 30
- sessions: [{"windowId":420611949,"focused":false,"windowType":"normal","incognito":false,"tabCount":9,"tabs":[{"id":420611962,"title":"Visual Studio Code 1.117","url":"https://code.visualstudio.com/updates/v1_117","active":true,"pinned":false,"discarded":false},{"id":420612184,"title":"扩展程序","url":"chrome://extensions/","active":false,"pinned":false,"discarded":false},{"id":420612116,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612117,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612118,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612119,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612120,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612121,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612207,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false}],"activeTab":{"id":420611962,"title":"Visual Studio Code 1.117","url":"https://code.visualstudio.com/updates/v1_117"}}]
- chromeConnected: true
- server-side timing: **未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)

## 总览（端到端 RTT + 工具开销 + 校验通过）

| ID | 分类 | n | 成功率 | 校验通过 | avg score | RTT p50 | RTT p95 | avg tools | redundant |
|---|---|---|---|---|---|---|---|---|---|
| W1 | extraction | 1 | 100% | 1/1 (100%) | 1 | 17830ms | 17830ms | 3 | 0 |

## 分类汇总

| 分类 | 场景数 | 总运行数 | 校验通过 | 平均 score | 平均 p50 RTT | 平均 tools |
|---|---|---|---|---|---|---|
| extraction | 1 | 1 | 1/1 (100%) | 1 | 17830ms | 3 |

## 各场景明细

### W1 — 抽取 — HN 前 10 条故事 JSON

- 维度: `extraction`  |  分类: `extraction`
- 理论最小 tool 调用: 4
- N: 1, 成功: 1, 成功率: 100.0%
- **Validator**: passed 1/1 (100%), avg score=1
- **RTT**: p50=**17830ms**, p95=**17830ms**, avg=17830ms, min=17830ms, max=17830ms
- 工具调用 (avg): total=3, read_page=1, screenshot=0, find=0, click=0, form_input=0
- **冗余调用** (avg): 0  |  **click 前重复确认** (avg): 0
- 重复 read_page 的运行占比: 0.0%  |  含 screenshot 的运行占比: 0.0%
- 工具错误总数: 0

## 注释

- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。
- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。
- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。
- 长尾扩展条件: 初始 N=1 内 p95/p50 > 3 时自动加跑到 30。
