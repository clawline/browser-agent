# browser-agent baseline 性能报告

- 时间: 2026-04-26T00:57:58.152Z
- HOOK_URL: http://127.0.0.1:4821/hook
- N (起点): 1, 长尾自动扩展: 30
- sessions: [{"windowId":420611949,"focused":true,"windowType":"normal","incognito":false,"tabCount":24,"tabs":[{"id":420611962,"title":"Example Domain","url":"https://example.com/","active":true,"pinned":false,"discarded":false},{"id":420612184,"title":"扩展程序","url":"chrome://extensions/","active":false,"pinned":false,"discarded":false},{"id":420612116,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612117,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612118,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612119,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612120,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612121,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612122,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612123,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612124,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612185,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612186,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612187,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612188,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612189,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612190,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612191,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612192,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612193,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612194,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612195,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612196,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false},{"id":420612197,"title":"新标签页","url":"chrome://newtab/","active":false,"pinned":false,"discarded":false}],"activeTab":{"id":420611962,"title":"Example Domain","url":"https://example.com/"}}]
- chromeConnected: true
- server-side timing: **未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)

## 总览（端到端 RTT + 工具开销 + 校验通过）

| ID | 分类 | n | 成功率 | 校验通过 | avg score | RTT p50 | RTT p95 | avg tools | redundant |
|---|---|---|---|---|---|---|---|---|---|
| W15 | workflow | 1 | 100% | 0/1 (0%) | 0.6 | 99320ms | 99320ms | 24 | 16 |

## 分类汇总

| 分类 | 场景数 | 总运行数 | 校验通过 | 平均 score | 平均 p50 RTT | 平均 tools |
|---|---|---|---|---|---|---|
| workflow | 1 | 1 | 0/1 (0%) | 0.6 | 99320ms | 24 |

## 各场景明细

### W15 — 一次性 — GitHub 多页导航 + 抽取

- 维度: `one-shot`  |  分类: `workflow`
- 理论最小 tool 调用: 8
- N: 1, 成功: 1, 成功率: 100.0%
- **Validator**: passed 0/1 (0%), avg score=0.6
- **RTT**: p50=**99320ms**, p95=**99320ms**, avg=99320ms, min=99320ms, max=99320ms
- 工具调用 (avg): total=24, read_page=3, screenshot=7, find=2, click=2, form_input=0
- **冗余调用** (avg): 16  |  **click 前重复确认** (avg): 2
- 重复 read_page 的运行占比: 100.0%  |  含 screenshot 的运行占比: 100.0%
- 工具错误总数: 0

## 注释

- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。
- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。
- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。
- 长尾扩展条件: 初始 N=1 内 p95/p50 > 3 时自动加跑到 30。
