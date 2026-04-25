#!/usr/bin/env node
/**
 * Clawline browser-agent performance benchmark driver
 *
 * Runs S1-S8 scenarios against the HTTP Hook on :4822 (configurable via HOOK_PORT).
 * Outputs perf-reports/<timestamp>/ with baseline.md, decisiveness.md, raw.json.
 *
 * Usage:
 *   node perf/scenarios.mjs                       # run all
 *   node perf/scenarios.mjs --scenarios=S1,S8     # subset (matches by id prefix)
 *   node perf/scenarios.mjs --n=10                # initial N (default 10)
 *   node perf/scenarios.mjs --skip-manual         # skip S6 (kill host) and S7 (multi-window)
 *   node perf/scenarios.mjs --label=baseline      # report folder label suffix
 *   HOOK_PORT=4822 node perf/scenarios.mjs        # override port
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);

const HOOK_PORT = process.env.HOOK_PORT || '4821';
const HOOK_URL = `http://127.0.0.1:${HOOK_PORT}/hook`;
const HEALTH_URL = `http://127.0.0.1:${HOOK_PORT}/`;
const SESSIONS_URL = `http://127.0.0.1:${HOOK_PORT}/sessions`;

// Per-task API override sent in every /hook body. NOT persisted to sidepanel
// localStorage. URL/model defaults are safe to hardcode; the API key MUST be
// supplied via env (CLAWLINE_API_KEY) — never commit a real key here.
const API_URL_OVERRIDE = process.env.CLAWLINE_API_URL || 'https://api.eagle.openclaws.co.uk';
const API_KEY_OVERRIDE = process.env.CLAWLINE_API_KEY || '';
const MODEL_OVERRIDE = process.env.CLAWLINE_MODEL || 'claude-haiku-4-5-20251001';

const N_DEFAULT = 10;
const N_LONGTAIL = 30;
const INTER_RUN_DELAY_MS = 750;
const FETCH_TIMEOUT_MS = 8 * 60 * 1000;

// ── CLI arg parsing ──

const argMap = Object.fromEntries(process.argv.slice(2).map(a => {
  const eq = a.indexOf('=');
  if (eq > 0) return [a.slice(0, eq).replace(/^--/, ''), a.slice(eq + 1)];
  return [a.replace(/^--/, ''), true];
}));
const SELECTED = argMap.scenarios ? String(argMap.scenarios).split(',').map(s => s.trim()) : null;
const N = parseInt(argMap.n || N_DEFAULT, 10);
const SKIP_MANUAL = argMap['skip-manual'] === true || argMap['skip-manual'] === 'true';
const LABEL = argMap.label || 'baseline';

// ── Scenario definitions ──

const SCENARIOS = [
  {
    id: 'S1',
    name: '导航 + DOM 抓取基线',
    dimension: 'baseline',
    task: 'Navigate to https://example.com. Then call read_page once with filter=interactive. Stop after that — no other tools.',
    theoretical_min_tools: 3,
    options: { include_tools: true },
  },
  {
    id: 'S2A',
    name: '点击延迟 — ref 路径',
    dimension: 'click-latency',
    task: 'Navigate to https://news.ycombinator.com. Then click the first story\'s title link (the headline, NOT the "comments" link). Use ref-based clicking via find or read_page. Do NOT take any screenshots.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
  },
  {
    id: 'S2B',
    name: '点击延迟 — 坐标路径',
    dimension: 'click-latency',
    task: 'Navigate to https://news.ycombinator.com. Take exactly one screenshot. Then click the first story title using coordinate-based clicking (computer left_click with coordinate parameter, NOT ref). Do not screenshot again.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
  },
  {
    id: 'S3',
    name: '表单填写吞吐',
    dimension: 'form-throughput',
    task: 'Navigate to https://httpbin.org/forms/post. Read the page once to get refs. Then use form_input to fill: customer name = "Alice", telephone = "13800000000", email = "a@b.com", size = "medium". Do NOT submit. Stop.',
    theoretical_min_tools: 7,
    options: { include_tools: true },
  },
  {
    id: 'S4',
    name: '长页面截图性能',
    dimension: 'screenshot',
    task: 'Navigate to https://en.wikipedia.org/wiki/Web_browser. Scroll down 5 ticks. Then take exactly one screenshot. Stop.',
    theoretical_min_tools: 4,
    options: { include_tools: true, include_screenshot: true },
  },
  {
    id: 'S5',
    name: '网络监听 + 重复 read_page 稳定性',
    dimension: 'network+repeat',
    task: 'Navigate to https://www.bing.com/search?q=test. Call read_network_requests once. Then call read_page (filter=interactive) three times in a row. Then call read_network_requests one more time. Stop.',
    theoretical_min_tools: 7,
    options: { include_tools: true },
  },
  {
    id: 'S8-T1',
    name: '决策果断性 — GitHub 顶部搜索',
    dimension: 'decisiveness',
    task: 'Open https://github.com. In the top navbar search box, type "react" and submit the search.',
    theoretical_min_tools: 5,
    options: { include_tools: true },
    decisiveness: true,
  },
  {
    id: 'S8-T2',
    name: '决策果断性 — Google Gmail 链接',
    dimension: 'decisiveness',
    task: 'Open https://www.google.com. Click the "Gmail" link visible on the page.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    decisiveness: true,
  },
  {
    id: 'S8-T3',
    name: '决策果断性 — HN 第3条评论链接',
    dimension: 'decisiveness',
    task: 'Open https://news.ycombinator.com. Click the "comments" link of the third story (NOT its title).',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    decisiveness: true,
  },
];

// ── Helpers ──

function log(msg) { process.stdout.write(msg + '\n'); }
function logRaw(msg) { process.stdout.write(msg); }

function pct(arr, q) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}
function avg(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
function fmt(x) { return Math.round(x * 100) / 100; }

function waitForUser(prompt) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt + '\n', () => { rl.close(); resolve(); });
  });
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('client timeout')), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Health checks ──

async function healthCheck() {
  let body;
  try {
    const res = await fetchWithTimeout(HEALTH_URL, {}, 5000);
    if (!res.ok) throw new Error(`status=${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new Error(`Health check failed for ${HEALTH_URL}: ${e.message}`);
  }
  if (!body.chromeConnected) throw new Error(`chromeConnected=false on ${HEALTH_URL}`);
  return body;
}

async function getSessions() {
  const res = await fetchWithTimeout(SESSIONS_URL, {}, 5000);
  if (!res.ok) throw new Error(`/sessions failed: ${res.status}`);
  const body = await res.json();
  return body.sessions || [];
}

// ── Run analysis ──

function analyzeRun(parsed, rtt_ms, scenario) {
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
  const calls = tools.filter(t => t.type === 'call');
  const results = tools.filter(t => t.type === 'result');

  const navigate_count = calls.filter(c => c.name === 'navigate').length;
  const read_page_count = calls.filter(c => c.name === 'read_page').length;
  const find_count = calls.filter(c => c.name === 'find').length;
  const form_input_count = calls.filter(c => c.name === 'form_input').length;
  const get_text_count = calls.filter(c => c.name === 'get_page_text').length;
  const turn_answer_count = calls.filter(c => c.name === 'turn_answer_start').length;
  const screenshot_count = calls.filter(c =>
    c.name === 'computer' && c.input?.action === 'screenshot'
  ).length;
  const click_count = calls.filter(c =>
    c.name === 'computer' && /click/.test(c.input?.action || '')
  ).length;
  const scroll_count = calls.filter(c =>
    c.name === 'computer' && c.input?.action === 'scroll'
  ).length;
  const type_count = calls.filter(c =>
    c.name === 'computer' && c.input?.action === 'type'
  ).length;
  const key_count = calls.filter(c =>
    c.name === 'computer' && c.input?.action === 'key'
  ).length;
  const wait_count = calls.filter(c =>
    c.name === 'computer' && c.input?.action === 'wait'
  ).length;
  const total_tools = calls.length;
  const tool_errors = results.filter(r => r.is_error).length;

  // Order-aware decisiveness signals: was there a read_page or screenshot
  // immediately before each click? Repeated re-confirmation is a hesitation signal.
  let reconfirm_before_click = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c.name !== 'computer' || !/click/.test(c.input?.action || '')) continue;
    // look back at most 2 steps
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
      const p = calls[j];
      if (p.name === 'read_page') { reconfirm_before_click++; break; }
      if (p.name === 'computer' && p.input?.action === 'screenshot') { reconfirm_before_click++; break; }
    }
  }

  const completed = parsed.status === 'completed';
  const min_tools = scenario.theoretical_min_tools || 0;
  const redundant_calls = Math.max(0, total_tools - min_tools);
  const ok = completed && tool_errors === 0;

  return {
    ok,
    status: parsed.status,
    rtt_ms,
    server_ms: parsed._timing?.server_ms ?? null,
    received_at: parsed._timing?.received_at ?? null,
    responded_at: parsed._timing?.responded_at ?? null,
    total_tools,
    navigate_count,
    read_page_count,
    find_count,
    form_input_count,
    get_text_count,
    turn_answer_count,
    screenshot_count,
    click_count,
    scroll_count,
    type_count,
    key_count,
    wait_count,
    tool_errors,
    redundant_calls,
    reconfirm_before_click,
    result_text: typeof parsed.result === 'string' ? parsed.result.slice(0, 200) : null,
    error: parsed.error || null,
  };
}

async function runOnce(scenario, extraBody = {}) {
  const t0 = performance.now();
  const body = {
    task: scenario.task,
    apiUrl: API_URL_OVERRIDE,
    apiKey: API_KEY_OVERRIDE,
    model: MODEL_OVERRIDE,
    ...(scenario.options || {}),
    ...extraBody,
  };
  let response;
  try {
    response = await fetchWithTimeout(HOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, rtt_ms: performance.now() - t0, http_error: true, error: `fetch: ${e.message}`, total_tools: 0 };
  }
  const rtt_ms = performance.now() - t0;
  let parsed;
  try { parsed = await response.json(); }
  catch (e) {
    return { ok: false, rtt_ms, http_status: response.status, error: 'invalid JSON', total_tools: 0 };
  }
  const analyzed = analyzeRun(parsed, rtt_ms, scenario);
  analyzed.http_status = response.status;
  analyzed.raw_tools = parsed.tools || [];
  return analyzed;
}

function computeStats(runs) {
  const ok_runs = runs.filter(r => r.ok);
  const rtts = ok_runs.map(r => r.rtt_ms);
  return {
    n: runs.length,
    success: ok_runs.length,
    success_rate: runs.length ? ok_runs.length / runs.length : 0,
    rtt_p50: Math.round(pct(rtts, 0.5)),
    rtt_p95: Math.round(pct(rtts, 0.95)),
    rtt_min: rtts.length ? Math.round(Math.min(...rtts)) : 0,
    rtt_max: rtts.length ? Math.round(Math.max(...rtts)) : 0,
    rtt_avg: Math.round(avg(rtts)),
    server_ms_p50: ok_runs.some(r => r.server_ms != null) ? Math.round(pct(ok_runs.map(r => r.server_ms || 0), 0.5)) : null,
    avg_total_tools: fmt(avg(ok_runs.map(r => r.total_tools))),
    avg_read_page: fmt(avg(ok_runs.map(r => r.read_page_count))),
    avg_screenshot: fmt(avg(ok_runs.map(r => r.screenshot_count))),
    avg_find: fmt(avg(ok_runs.map(r => r.find_count))),
    avg_form_input: fmt(avg(ok_runs.map(r => r.form_input_count))),
    avg_click: fmt(avg(ok_runs.map(r => r.click_count))),
    avg_redundant: fmt(avg(ok_runs.map(r => r.redundant_calls))),
    avg_reconfirm: fmt(avg(ok_runs.map(r => r.reconfirm_before_click))),
    pct_runs_with_repeated_read_page: ok_runs.length ? fmt(ok_runs.filter(r => r.read_page_count > 1).length / ok_runs.length) : 0,
    pct_runs_with_screenshot: ok_runs.length ? fmt(ok_runs.filter(r => r.screenshot_count > 0).length / ok_runs.length) : 0,
    tool_errors_total: ok_runs.reduce((s, r) => s + r.tool_errors, 0),
  };
}

async function runStandardScenario(scenario, n) {
  log(`\n▶ ${scenario.id}: ${scenario.name}  (n=${n}, dim=${scenario.dimension})`);
  const runs = [];
  for (let i = 1; i <= n; i++) {
    logRaw(`  [${scenario.id} ${i}/${n}] `);
    const r = await runOnce(scenario);
    runs.push(r);
    const summary = r.ok
      ? `✓ rtt=${Math.round(r.rtt_ms)}ms tools=${r.total_tools} rp=${r.read_page_count} ss=${r.screenshot_count} click=${r.click_count} red=${r.redundant_calls}`
      : `✗ rtt=${Math.round(r.rtt_ms)}ms ERR=${(r.error || r.status || '').slice(0, 60)}`;
    log(summary);
    if (i < n) await new Promise(rs => setTimeout(rs, INTER_RUN_DELAY_MS));
  }
  let stats = computeStats(runs);

  if (n < N_LONGTAIL && stats.rtt_p50 > 0 && stats.rtt_p95 / stats.rtt_p50 > 3) {
    log(`  ⤷ long tail detected (p95/p50=${(stats.rtt_p95 / stats.rtt_p50).toFixed(2)}), extending to N=${N_LONGTAIL}`);
    for (let i = n + 1; i <= N_LONGTAIL; i++) {
      logRaw(`  [${scenario.id} ${i}/${N_LONGTAIL}] `);
      const r = await runOnce(scenario);
      runs.push(r);
      const summary = r.ok
        ? `✓ rtt=${Math.round(r.rtt_ms)}ms tools=${r.total_tools}`
        : `✗ rtt=${Math.round(r.rtt_ms)}ms ERR=${(r.error || r.status || '').slice(0, 60)}`;
      log(summary);
      await new Promise(rs => setTimeout(rs, INTER_RUN_DELAY_MS));
    }
    stats = computeStats(runs);
  }
  return { id: scenario.id, name: scenario.name, dimension: scenario.dimension, theoretical_min_tools: scenario.theoretical_min_tools, decisiveness: !!scenario.decisiveness, stats, runs };
}

// ── S6: Reconnect resilience (auto: kills native-host, polls for SW auto-reconnect) ──

function execCmd(cmd, args) {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => resolve({ code, out, err }));
  });
}

async function runS6() {
  log(`\n▶ S6: Reconnect 抖动 (auto: pkill + poll for SW auto-reconnect)`);
  const out = { id: 'S6', name: 'Reconnect 抖动', dimension: 'reconnect', steps: [] };

  // Step 1: confirm hook is up
  log(`  Step 1: baseline probe`);
  try {
    const r = await fetchWithTimeout(HEALTH_URL, {}, 3000);
    const b = r.ok ? await r.json() : null;
    out.steps.push({ step: 'baseline', ok: !!b?.chromeConnected });
    if (!b?.chromeConnected) throw new Error('hook not healthy at start');
    log(`  ✓ baseline OK`);
  } catch (e) {
    log(`  ✗ baseline failed: ${e.message}`);
    out.steps.push({ step: 'baseline', ok: false, error: e.message });
    return out;
  }

  // Step 2: pkill native-host
  log(`  Step 2: killing native-host (pkill -f 'native-host/index.js')`);
  const t_kill = performance.now();
  const killRes = await execCmd('pkill', ['-f', 'native-host/index.js']);
  out.steps.push({ step: 'pkill', code: killRes.code });
  log(`  pkill exit code=${killRes.code}`);

  // Step 3: verify down
  log(`  Step 3: verifying down...`);
  let down = false;
  let down_after_ms = null;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetchWithTimeout(HEALTH_URL, {}, 1000);
      if (!r.ok) { down = true; down_after_ms = performance.now() - t_kill; break; }
      const b = await r.json().catch(() => ({}));
      if (!b.chromeConnected) { down = true; down_after_ms = performance.now() - t_kill; break; }
    } catch { down = true; down_after_ms = performance.now() - t_kill; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  out.steps.push({ step: 'down_confirmed', ok: down, down_after_ms: down_after_ms ? Math.round(down_after_ms) : null });
  if (!down) {
    log(`  ✗ host did not appear down within 2.5s`);
    return out;
  }
  log(`  ✓ host down after ${Math.round(down_after_ms || 0)}ms`);

  // Step 4: poll for SW auto-reconnect (SW backoff: 1s, 2s, 4s, ... max 30s, 10 attempts)
  log(`  Step 4: polling /4822/ for recovery (max 60s; SW backoff 1→30s, 10 attempts)...`);
  const t_recovery_start = performance.now();
  let recovered_ms = null;
  let attempts = 0, failures = 0;
  const deadline = t_recovery_start + 60000;
  while (performance.now() < deadline) {
    attempts++;
    try {
      const r = await fetchWithTimeout(HEALTH_URL, {}, 1500);
      if (r.ok) {
        const b = await r.json().catch(() => ({}));
        if (b.chromeConnected) {
          recovered_ms = performance.now() - t_recovery_start;
          break;
        }
      }
      failures++;
    } catch { failures++; }
    await new Promise(r => setTimeout(r, 500));
  }
  out.steps.push({ step: 'recovery', recovered_ms: recovered_ms == null ? null : Math.round(recovered_ms), attempts, failures });
  if (recovered_ms == null) log(`  ✗ did not recover within 60s (${attempts} attempts, ${failures} failures)`);
  else log(`  ✓ recovered after ${Math.round(recovered_ms)}ms (${attempts} attempts, ${failures} failures)`);

  // Step 5: confirm sidepanel still registered after reconnect
  if (recovered_ms != null) {
    try {
      const sess = await getSessions();
      out.steps.push({ step: 'sessions_after_recovery', sessions: sess });
      log(`  Step 5: sessions after recovery: ${JSON.stringify(sess)}`);
      if (sess.length === 0) log(`  ⚠ no sidepanel registered after reconnect — may need reload`);
    } catch (e) {
      out.steps.push({ step: 'sessions_after_recovery', error: e.message });
    }
  }

  return out;
}

// ── S7: concurrent multi-window dispatch ──

async function runS7() {
  log(`\n▶ S7: 多 window 并发分发`);
  const out = { id: 'S7', name: '多 window 并发分发', dimension: 'concurrency' };
  let sessions = await getSessions();
  log(`  Current sidepanels: ${JSON.stringify(sessions)}`);
  if (sessions.length < 2) {
    // Auto-skip when only one sidepanel — we don't ask the operator interactively.
    log(`  ⏭ skipped: only ${sessions.length} sidepanel(s) registered (S7 needs ≥2)`);
    return { ...out, skipped: true, reason: `only ${sessions.length} sidepanel(s)` };
  }
  const w1 = sessions[0].windowId;
  const w2 = sessions[1].windowId;
  log(`  Using windowIds: w1=${w1}, w2=${w2}`);

  const scenarioStub = (task, theoretical) => ({
    id: 'S7-stub',
    name: 'S7 stub',
    task,
    theoretical_min_tools: theoretical,
    options: { include_tools: true },
  });

  log(`  Firing 3 concurrent tasks...`);
  const t0 = performance.now();
  const [r1, r2, r3] = await Promise.all([
    runOnce(scenarioStub('Navigate to https://example.com and stop.', 2), { windowId: w1 }),
    runOnce(scenarioStub('Navigate to https://example.org and stop.', 2), { windowId: w2 }),
    runOnce(scenarioStub('Read the current page once with read_page filter=interactive and stop.', 2)),
  ]);
  const total_wall_ms = performance.now() - t0;
  const rtts = [r1.rtt_ms, r2.rtt_ms, r3.rtt_ms];
  const fairness = Math.max(...rtts) / Math.max(1, Math.min(...rtts));
  log(`  ✓ wall=${Math.round(total_wall_ms)}ms rtts=[${rtts.map(x => Math.round(x)).join(',')}] fairness=${fairness.toFixed(2)}`);
  return { ...out, w1, w2, runs: [r1, r2, r3], total_wall_ms: Math.round(total_wall_ms), fairness_max_min_ratio: fmt(fairness) };
}

// ── Markdown rendering ──

function mdStandardSection(r) {
  const s = r.stats;
  return `### ${r.id} — ${r.name}

- 维度: \`${r.dimension}\`
- 理论最小 tool 调用: ${r.theoretical_min_tools}
- N: ${s.n}, 成功: ${s.success}, 成功率: ${(s.success_rate * 100).toFixed(1)}%
- **RTT**: p50=**${s.rtt_p50}ms**, p95=**${s.rtt_p95}ms**, avg=${s.rtt_avg}ms, min=${s.rtt_min}ms, max=${s.rtt_max}ms
${s.server_ms_p50 != null ? `- server-side p50: ${s.server_ms_p50}ms\n` : ''}- 工具调用 (avg): total=${s.avg_total_tools}, read_page=${s.avg_read_page}, screenshot=${s.avg_screenshot}, find=${s.avg_find}, click=${s.avg_click}, form_input=${s.avg_form_input}
- **冗余调用** (avg): ${s.avg_redundant}  |  **click 前重复确认** (avg): ${s.avg_reconfirm}
- 重复 read_page 的运行占比: ${(s.pct_runs_with_repeated_read_page * 100).toFixed(1)}%  |  含 screenshot 的运行占比: ${(s.pct_runs_with_screenshot * 100).toFixed(1)}%
- 工具错误总数: ${s.tool_errors_total}
`;
}

function mdManualSection(r) {
  if (r.id === 'S6') {
    const recov = r.steps.find(s => s.step === 'recovery');
    return `### S6 — Reconnect 抖动 (manual)

- 维度: \`reconnect\`
- 步骤记录: ${r.steps.map(s => `\n  - ${s.step}: ${JSON.stringify(s)}`).join('')}
- **恢复时间**: ${recov?.recovered_ms != null ? recov.recovered_ms + 'ms' : 'N/A (未恢复)'}
- 失败请求次数: ${recov?.failures ?? 'N/A'}
- 总尝试次数: ${recov?.attempts ?? 'N/A'}
`;
  }
  if (r.id === 'S7') {
    if (r.skipped) return `### S7 — 多 window 并发分发\n\n- **跳过**: ${r.reason}\n`;
    const rtts = r.runs.map(x => Math.round(x.rtt_ms));
    return `### S7 — 多 window 并发分发

- 维度: \`concurrency\`
- windowIds: w1=${r.w1}, w2=${r.w2}
- 三任务并发 RTT: [${rtts.join(', ')}] ms
- 总 wall time: ${r.total_wall_ms}ms
- **公平性 (max/min)**: ${r.fairness_max_min_ratio}× ${r.fairness_max_min_ratio > 3 ? '⚠ 偏差过大' : ''}
- 各任务成功: ${r.runs.map((x, i) => `T${i + 1}=${x.ok ? '✓' : '✗'}`).join(', ')}
`;
  }
  return '';
}

function mdDecisivenessHighlight(results) {
  const dec = results.filter(r => r.decisiveness);
  if (dec.length === 0) return '';
  let md = `## 🔥 决策果断性高亮 (S8)\n\n按 resley 强调，这是核心维度。所有 S8 子任务的犹豫信号汇总如下:\n\n`;
  md += `| 子任务 | n | 成功率 | RTT p50 | avg total tools | avg read_page | avg screenshot | avg redundant | click前重复确认 | 重复 read_page 运行% |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of dec) {
    const s = r.stats;
    md += `| ${r.id} ${r.name} | ${s.n} | ${(s.success_rate * 100).toFixed(0)}% | ${s.rtt_p50}ms | ${s.avg_total_tools} | ${s.avg_read_page} | ${s.avg_screenshot} | ${s.avg_redundant} | ${s.avg_reconfirm} | ${(s.pct_runs_with_repeated_read_page * 100).toFixed(0)}% |\n`;
  }
  md += `\n**预警阈值** (resley 提的):\n- 冗余调用 > 3 → 偏离最优路径\n- 任一子任务首次命中率 < 80% → 决策不准\n- ≥ 2 次连续 read_page → 视觉再确认 / 犹豫\n\n`;
  return md;
}

function mdSummaryTable(allResults) {
  let md = `## 总览（端到端 RTT + 工具开销）\n\n`;
  md += `| ID | 维度 | n | 成功率 | RTT p50 | RTT p95 | avg tools | redundant | 备注 |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of allResults) {
    if (!r.stats) continue;
    const s = r.stats;
    md += `| ${r.id} | ${r.dimension} | ${s.n} | ${(s.success_rate * 100).toFixed(0)}% | ${s.rtt_p50}ms | ${s.rtt_p95}ms | ${s.avg_total_tools} | ${s.avg_redundant} | ${r.decisiveness ? '决策维度' : ''} |\n`;
  }
  md += `\n`;
  return md;
}

// ── Orchestrator ──

async function main() {
  log(`\n=== Clawline browser-agent perf benchmark ===`);
  log(`HOOK_URL=${HOOK_URL}`);
  log(`N=${N}, longtail=${N_LONGTAIL}, label=${LABEL}, skip-manual=${SKIP_MANUAL}`);
  if (SELECTED) log(`Selected scenarios: ${SELECTED.join(',')}`);

  // Step 1: health check
  log(`\n[1/2] Health check...`);
  const health = await healthCheck();
  log(`  ✓ ${HEALTH_URL} → ${JSON.stringify(health)}`);

  // Step 2: sessions
  log(`\n[2/2] Sessions...`);
  const sessions = await getSessions();
  log(`  ✓ sidepanels: ${JSON.stringify(sessions)}`);
  if (sessions.length === 0) throw new Error('No sidepanel registered. Open the extension side panel first.');

  const env = {
    timestamp: new Date().toISOString(),
    git_head: null,
    hook_url: HOOK_URL,
    health,
    sessions,
    n_default: N,
    n_longtail: N_LONGTAIL,
  };

  // Step 3: run scenarios
  const results = [];
  const standardScenarios = SCENARIOS.filter(s =>
    !SELECTED || SELECTED.some(sel => s.id.startsWith(sel))
  );

  for (const scenario of standardScenarios) {
    try {
      const r = await runStandardScenario(scenario, N);
      results.push(r);
    } catch (e) {
      log(`  ✗ ${scenario.id} threw: ${e.message}`);
      results.push({ id: scenario.id, name: scenario.name, dimension: scenario.dimension, error: e.message });
      throw e;  // Stop on failure per resley's directive
    }
  }

  // S6 + S7 (manual)
  if (!SKIP_MANUAL) {
    if (!SELECTED || SELECTED.some(sel => 'S6'.startsWith(sel))) {
      try { results.push(await runS6()); }
      catch (e) { log(`  ✗ S6 threw: ${e.message}`); results.push({ id: 'S6', error: e.message }); throw e; }
    }
    if (!SELECTED || SELECTED.some(sel => 'S7'.startsWith(sel))) {
      try { results.push(await runS7()); }
      catch (e) { log(`  ✗ S7 threw: ${e.message}`); results.push({ id: 'S7', error: e.message }); throw e; }
    }
  }

  // Output
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const outDir = join(REPO_ROOT, 'perf-reports', `${ts}_${LABEL}`);
  mkdirSync(outDir, { recursive: true });

  // Raw JSON (full)
  writeFileSync(join(outDir, 'raw.json'), JSON.stringify({ env, results }, null, 2));

  // Trimmed JSON (no raw_tools dumps for compactness)
  const trimmed = results.map(r => {
    if (!r.runs) return r;
    return { ...r, runs: r.runs.map(({ raw_tools, ...rest }) => rest) };
  });
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ env, results: trimmed }, null, 2));

  // baseline.md
  let md = `# browser-agent baseline 性能报告\n\n`;
  md += `- 时间: ${env.timestamp}\n`;
  md += `- HOOK_URL: ${HOOK_URL}\n`;
  md += `- N (起点): ${N}, 长尾自动扩展: ${N_LONGTAIL}\n`;
  md += `- sessions: ${JSON.stringify(sessions)}\n`;
  md += `- chromeConnected: ${health.chromeConnected}\n`;
  md += `- server-side timing: ${results.some(r => r.runs?.some(x => x.server_ms != null)) ? '有数据' : '**未启用** (CLAWLINE_TIMING=1 + 重启 native-host 后再跑)'}\n\n`;
  md += mdSummaryTable(results);
  md += mdDecisivenessHighlight(results);
  md += `## 各场景明细\n\n`;
  for (const r of results) {
    if (r.error) { md += `### ${r.id} — ❌ 错误\n\n${r.error}\n\n`; continue; }
    if (r.id === 'S6' || r.id === 'S7') md += mdManualSection(r);
    else md += mdStandardSection(r);
  }
  md += `\n## 注释\n\n- **冗余调用** = 总 tool_use − 该场景理论最小 tool 数。负值已截到 0。\n- **click 前重复确认** = 在每次 click 前 2 步内出现 read_page 或 screenshot 的累计次数。\n- **首次命中率**: 当前未直接量化（agent 无明确"重试"信号），用 click_count / 任务期望 click 数作为代理。\n- 长尾扩展条件: 初始 N=${N} 内 p95/p50 > 3 时自动加跑到 ${N_LONGTAIL}。\n`;
  writeFileSync(join(outDir, 'baseline.md'), md);

  // decisiveness.md
  const decMd = `# 决策果断性专项 (S8 + S2 旁证)\n\n`
    + mdDecisivenessHighlight(results)
    + `\n## S2 旁证 (ref vs 坐标路径下的犹豫)\n\n`
    + (results.filter(r => r.id === 'S2A' || r.id === 'S2B').map(r => mdStandardSection(r)).join('\n'))
    + `\n## S8 详细\n\n`
    + (results.filter(r => r.decisiveness).map(r => mdStandardSection(r)).join('\n'));
  writeFileSync(join(outDir, 'decisiveness.md'), decMd);

  log(`\n✅ Reports written to: ${outDir}`);
  log(`  - baseline.md`);
  log(`  - decisiveness.md`);
  log(`  - summary.json`);
  log(`  - raw.json`);
  return outDir;
}

main().catch(e => {
  console.error(`\n❌ FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
