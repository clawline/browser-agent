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

// Default values are FALSY so they don't override the sidepanel's own config.
// Set via env when you want a per-task override (e.g. for A/B testing endpoints).
const API_URL_OVERRIDE = process.env.CLAWLINE_API_URL || '';
const API_KEY_OVERRIDE = process.env.CLAWLINE_API_KEY || '';
const MODEL_OVERRIDE = process.env.CLAWLINE_MODEL || '';

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

// ── Per-category default N (heavy scenarios run fewer times) ──

const N_BY_CATEGORY = {
  atomic: 10,
  decisiveness: 10,
  extraction: 5,
  manipulation: 5,
  forms: 5,
  workflow: 3,
  devtools: 3,
};
function defaultNForCategory(cat) { return N_BY_CATEGORY[cat] || N; }

// ── Validator helpers (used by W* scenarios to score result correctness) ──

const v = {
  // Count distinct URLs in text. Matches http(s)://...
  countURLs(text) {
    const m = text?.match(/https?:\/\/[^\s)<>"'`]+/g) || [];
    return new Set(m).size;
  },
  // Number of digit groups (proxy for "contains N numeric metrics")
  countNumbers(text, minDigits = 1) {
    const re = new RegExp(`\\b\\d{${minDigits},}\\b`, 'g');
    return (text?.match(re) || []).length;
  },
  // All phrases must appear (case-insensitive)
  containsAll(text, phrases) {
    const lower = (text || '').toLowerCase();
    const missing = phrases.filter(p => !lower.includes(p.toLowerCase()));
    return { passed: missing.length === 0, missing };
  },
  // At least one of these phrases (case-insensitive)
  containsAny(text, phrases) {
    const lower = (text || '').toLowerCase();
    return phrases.some(p => lower.includes(p.toLowerCase()));
  },
  // None of these phrases (case-insensitive)
  containsNone(text, phrases) {
    const lower = (text || '').toLowerCase();
    const found = phrases.filter(p => lower.includes(p.toLowerCase()));
    return { passed: found.length === 0, found };
  },
  // Detect a JSON array with at least minItems items, parsing tolerantly
  hasJSONArray(text, minItems) {
    if (!text) return { passed: false, count: 0 };
    // Find largest JSON array-ish substring
    const matches = text.match(/\[\s*\{[^[]*?\}\s*(?:,\s*\{[^[]*?\}\s*)*\]/g) || [];
    let best = 0;
    for (const m of matches) {
      try {
        const arr = JSON.parse(m);
        if (Array.isArray(arr)) best = Math.max(best, arr.length);
      } catch {}
    }
    // Fallback: count "title:" / "name:" mentions if JSON parsing fails
    if (best < minItems) {
      const titleHits = (text.match(/["']?(title|name|rank|number)["']?\s*[:=]/gi) || []).length;
      best = Math.max(best, titleHits);
    }
    return { passed: best >= minItems, count: best };
  },
  // Match a regex
  matches(text, regex) { return regex.test(text || ''); },
};

// ── Scenario definitions ──

// Each scenario:
//   id: short label (S* atomic, W* workflow)
//   name: human-readable Chinese name
//   category: 'atomic' | 'extraction' | 'manipulation' | 'forms' | 'workflow' | 'devtools' | 'decisiveness'
//   dimension: free-text legacy field (kept for backwards compat)
//   task: prompt sent to the agent
//   theoretical_min_tools: lower bound used to compute "redundant calls"
//   options: { include_tools, include_screenshot } passed via /hook body
//   validator: (resultText, meta) => { passed, score (0..1), details }
//   timeout_ms: override default fetch timeout (8 min)
//   n_override: number of runs (else falls back to defaultNForCategory)
//   decisiveness: legacy boolean — kept for the existing decisiveness highlight

const SCENARIOS = [
  // ── Atomic baselines (single-tool latency / stability) ──
  {
    id: 'S1',
    name: '导航 + DOM 抓取基线',
    category: 'atomic',
    dimension: 'baseline',
    task: 'Navigate to https://example.com. Then call read_page once with filter=interactive. Stop after that — no other tools.',
    theoretical_min_tools: 3,
    options: { include_tools: true },
  },
  {
    id: 'S2A',
    name: '点击延迟 — ref 路径',
    category: 'atomic',
    dimension: 'click-latency',
    task: 'Navigate to https://news.ycombinator.com. Then click the first story\'s title link (the headline, NOT the "comments" link). Use ref-based clicking via find or read_page. Do NOT take any screenshots.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
  },
  {
    id: 'S2B',
    name: '点击延迟 — 坐标路径',
    category: 'atomic',
    dimension: 'click-latency',
    task: 'Navigate to https://news.ycombinator.com. Take exactly one screenshot. Then click the first story title using coordinate-based clicking (computer left_click with coordinate parameter, NOT ref). Do not screenshot again.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
  },
  {
    id: 'S4',
    name: '长页面截图性能',
    category: 'atomic',
    dimension: 'screenshot',
    task: 'Navigate to https://en.wikipedia.org/wiki/Web_browser. Scroll down 5 ticks. Then take exactly one screenshot. Stop.',
    theoretical_min_tools: 4,
    options: { include_tools: true, include_screenshot: true },
  },
  {
    id: 'S5',
    name: '网络监听 + 重复 read_page 稳定性',
    category: 'atomic',
    dimension: 'network+repeat',
    task: 'Navigate to https://www.bing.com/search?q=test. Call read_network_requests once. Then call read_page (filter=interactive) three times in a row. Then call read_network_requests one more time. Stop.',
    theoretical_min_tools: 7,
    options: { include_tools: true },
  },

  // ── Decisiveness (S8 series — atomic decision-making) ──
  {
    id: 'S8-T1',
    name: '决策果断性 — GitHub 顶部搜索',
    category: 'decisiveness',
    dimension: 'decisiveness',
    task: 'Open https://github.com. In the top navbar search box, type "react" and submit the search.',
    theoretical_min_tools: 5,
    options: { include_tools: true },
    decisiveness: true,
  },
  {
    id: 'S8-T2',
    name: '决策果断性 — Google Gmail 链接',
    category: 'decisiveness',
    dimension: 'decisiveness',
    task: 'Open https://www.google.com. Click the "Gmail" link visible on the page.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    decisiveness: true,
  },
  {
    id: 'S8-T3',
    name: '决策果断性 — HN 第3条评论链接',
    category: 'decisiveness',
    dimension: 'decisiveness',
    task: 'Open https://news.ycombinator.com. Click the "comments" link of the third story (NOT its title).',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    decisiveness: true,
  },

  // ── A. Structured Extraction (W1-W4) ──
  {
    id: 'W1',
    name: '抽取 — HN 前 10 条故事 JSON',
    category: 'extraction',
    dimension: 'extraction',
    task: 'Open https://news.ycombinator.com. Read the page and extract the top 10 stories. Output as a JSON array with each item containing: rank, title, url, score (number), author, comments_count (number), age. Output ONLY the JSON array, no preamble.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    timeout_ms: 5 * 60 * 1000,
    validator: (text) => {
      const j = v.hasJSONArray(text, 10);
      const titles = v.matches(text, /title["']?\s*[:=]/i);
      const scores = v.countNumbers(text, 1) >= 10;
      const passed = j.passed && titles && scores;
      const score = (j.passed ? 0.5 : Math.min(j.count, 10) / 20) + (titles ? 0.25 : 0) + (scores ? 0.25 : 0);
      return { passed, score: Math.min(1, score), details: `items=${j.count}, titles=${titles}, scores=${scores}` };
    },
  },
  {
    id: 'W2',
    name: '抽取 — GitHub repo 元数据',
    category: 'extraction',
    dimension: 'extraction',
    task: 'Open https://github.com/facebook/react. Extract repository metrics. Output a JSON object with these keys (omit any you cannot find): stars, forks, watchers, open_issues, latest_release_tag, primary_language, license, contributors_count. Use the actual numeric/string values from the page. Output ONLY the JSON, no preamble.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    timeout_ms: 5 * 60 * 1000,
    validator: (text) => {
      const numbers = v.countNumbers(text, 1);
      const keys = ['stars', 'forks', 'language', 'react'];
      const present = keys.filter(k => (text || '').toLowerCase().includes(k.toLowerCase())).length;
      const passed = numbers >= 4 && present >= 3;
      return { passed, score: Math.min(1, numbers / 6 * 0.5 + present / 4 * 0.5), details: `numbers=${numbers}, keysPresent=${present}/4` };
    },
  },
  {
    id: 'W3',
    name: '抽取 — Wikipedia infobox',
    category: 'extraction',
    dimension: 'extraction',
    task: 'Open https://en.wikipedia.org/wiki/Donald_Knuth. Find the infobox on the right side of the page. Extract its key-value pairs (Born, Education, Known for, Awards, Spouse, etc.). Output as a JSON object. Output ONLY the JSON, no preamble.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    timeout_ms: 5 * 60 * 1000,
    validator: (text) => {
      // Count key:value style lines in the result
      const colons = (text?.match(/["']?\w[\w\s]+["']?\s*:\s*["[]/g) || []).length;
      const knuth = v.containsAny(text, ['Knuth', 'Stanford', 'Turing']);
      const passed = colons >= 5 && knuth;
      return { passed, score: Math.min(1, colons / 8 * 0.7 + (knuth ? 0.3 : 0)), details: `kvPairs=${colons}, hasKnuthFacts=${knuth}` };
    },
  },
  {
    id: 'W4',
    name: '抽取 — Google 搜索结果（过滤广告）',
    category: 'extraction',
    dimension: 'extraction',
    task: 'Open https://www.google.com/search?q=react+hooks+tutorial. Extract the top 5 ORGANIC search results (skip any sponsored/ad results). For each output: title, url, description. Output as a JSON array. Output ONLY the JSON, no preamble.',
    theoretical_min_tools: 4,
    options: { include_tools: true },
    timeout_ms: 5 * 60 * 1000,
    validator: (text) => {
      const urls = v.countURLs(text);
      const j = v.hasJSONArray(text, 5);
      const noAd = v.containsNone(text, ['Sponsored', 'Ad·', 'sponsor']).passed;
      const passed = urls >= 5 && j.passed && noAd;
      return { passed, score: Math.min(1, (urls >= 5 ? 0.4 : urls / 12) + (j.passed ? 0.4 : 0) + (noAd ? 0.2 : 0)), details: `urls=${urls}, items=${j.count}, noAd=${noAd}` };
    },
  },

  // ── B. Page Manipulation (W5-W7) ──
  {
    id: 'W5',
    name: '操控 — TodoMVC 完整流程',
    category: 'manipulation',
    dimension: 'manipulation',
    task: 'Open https://todomvc.com/examples/react/dist/. Add 5 todos: "buy milk", "write report", "call dentist", "fix bug", "read book". Then mark items 1 and 3 as complete. Then delete item 5 ("read book"). Finally, report the final state by reading the page: how many active items, how many completed items, and list all remaining items. Output format: "active: N, completed: M, items: [...]"',
    theoretical_min_tools: 16,
    options: { include_tools: true },
    timeout_ms: 6 * 60 * 1000,
    validator: (text) => {
      const lower = (text || '').toLowerCase();
      const hasActive = /active.*[:：]\s*2|2\s*(items?\s*)?(left|active)/i.test(text || '');
      const hasCompleted = /completed.*[:：]\s*2|2\s*completed/i.test(text || '');
      const hasMilk = lower.includes('milk');
      const hasNoBook = !lower.includes('read book') || lower.includes('delete') || lower.includes('removed');
      const passed = hasActive && hasCompleted && hasMilk;
      return { passed, score: (hasActive ? 0.4 : 0) + (hasCompleted ? 0.3 : 0) + (hasMilk ? 0.2 : 0) + (hasNoBook ? 0.1 : 0), details: `active=${hasActive}, completed=${hasCompleted}, milk=${hasMilk}` };
    },
  },
  {
    id: 'W6',
    name: '操控 — 多 tab 编排',
    category: 'manipulation',
    dimension: 'manipulation',
    task: 'Use tabs_create three times to open: (1) https://developer.mozilla.org, (2) https://react.dev, (3) https://vuejs.org. After each opens, read its page title. Then close the second tab (react.dev). Finally report all three titles in order, and which tab is now closed. Output format: "MDN title: ..., React title: ..., Vue title: ..., closed: react".',
    theoretical_min_tools: 9,
    options: { include_tools: true },
    timeout_ms: 6 * 60 * 1000,
    validator: (text) => {
      const lower = (text || '').toLowerCase();
      const hasMDN = lower.includes('mdn') || lower.includes('mozilla');
      const hasReact = lower.includes('react');
      const hasVue = lower.includes('vue');
      const hasClosed = lower.includes('closed') || lower.includes('close');
      const passed = hasMDN && hasReact && hasVue && hasClosed;
      return { passed, score: [hasMDN, hasReact, hasVue, hasClosed].filter(Boolean).length / 4, details: `mdn=${hasMDN}, react=${hasReact}, vue=${hasVue}, closed=${hasClosed}` };
    },
  },
  {
    id: 'W7',
    name: '操控 — HN 多分区切换',
    category: 'manipulation',
    dimension: 'manipulation',
    task: 'Open https://news.ycombinator.com. Click the "show" link in the top nav (Show HN section), read the first headline. Then click the "ask" link (Ask HN section), read its first headline. Then click "newest", read its first headline. Finally output all three headlines, labeled by section. Format: "Show: <headline>; Ask: <headline>; Newest: <headline>".',
    theoretical_min_tools: 9,
    options: { include_tools: true },
    timeout_ms: 6 * 60 * 1000,
    validator: (text) => {
      const lower = (text || '').toLowerCase();
      const sections = ['show', 'ask', 'newest'].filter(s => lower.includes(s + ':') || lower.includes(s + ' hn') || lower.includes(s + '：')).length;
      const headlines = (text || '').split(/[;\n；]/).filter(line => line.trim().length > 10).length;
      const passed = sections >= 3 && headlines >= 3;
      return { passed, score: sections / 3 * 0.6 + Math.min(headlines / 3, 1) * 0.4, details: `sectionsLabeled=${sections}, headlines=${headlines}` };
    },
  },

  // ── C. Complex Forms (W8-W10) ──
  {
    id: 'W8',
    name: '表单 — httpbin 完整字段',
    category: 'forms',
    dimension: 'forms',
    task: 'Open https://httpbin.org/forms/post. Fill ALL form fields using batch_form_input where possible: customer name = "Alice Wong", telephone = "13800138000", email = "alice@example.com", size = "medium" (radio), pizza toppings = "bacon" AND "cheese" (two checkboxes), preferred delivery time = "13:30", delivery date = "2026-12-31", comments = "no onions please". Do NOT submit. After filling, read the form back and report the filled values. Output ONLY a JSON object of {fieldName: value} pairs.',
    theoretical_min_tools: 6,
    options: { include_tools: true },
    timeout_ms: 6 * 60 * 1000,
    validator: (text) => {
      const phrases = ['alice', '13800138000', 'medium', 'bacon', 'cheese', '13:30', 'no onions'];
      const lower = (text || '').toLowerCase();
      const present = phrases.filter(p => lower.includes(p.toLowerCase())).length;
      const passed = present >= 7;
      return { passed, score: present / phrases.length, details: `valuesPresent=${present}/${phrases.length}` };
    },
  },
  {
    id: 'W9',
    name: '表单 — 下拉/单选/多选混合',
    category: 'forms',
    dimension: 'forms',
    task: 'Open https://www.w3schools.com/html/tryit.asp?filename=tryhtml_form_submit. Click "Run >>" button to load the form. Switch focus to the iframe with id "iframeResult". Inside that frame: fill firstname = "John", lastname = "Doe", then submit. Report the URL the form submitted to (visible after submit) and any echoed values.',
    theoretical_min_tools: 8,
    options: { include_tools: true },
    timeout_ms: 6 * 60 * 1000,
    validator: (text) => {
      const lower = (text || '').toLowerCase();
      const hasJohn = lower.includes('john');
      const hasDoe = lower.includes('doe');
      const hasURL = v.countURLs(text) >= 1;
      const passed = hasJohn && hasDoe && hasURL;
      return { passed, score: (hasJohn ? 0.35 : 0) + (hasDoe ? 0.35 : 0) + (hasURL ? 0.3 : 0), details: `john=${hasJohn}, doe=${hasDoe}, url=${hasURL}` };
    },
  },
  {
    id: 'W10',
    name: '表单 — 日期时间 + 校验反馈',
    category: 'forms',
    dimension: 'forms',
    task: 'Open https://demoqa.com/automation-practice-form. Fill: First Name = "Test", Last Name = "User", Email = "test@example.com", Mobile = "1234567890", Date of Birth (calendar input) = "15 Jun 1990". Skip the rest. Click Submit. Report whatever the result modal/dialog shows. If the page is blocked or doesn\'t load, report that explicitly.',
    theoretical_min_tools: 9,
    options: { include_tools: true },
    timeout_ms: 6 * 60 * 1000,
    validator: (text) => {
      const lower = (text || '').toLowerCase();
      const hasTest = lower.includes('test');
      const hasUser = lower.includes('user');
      const hasEmail = lower.includes('test@example.com') || lower.includes('@example');
      const hasResult = v.containsAny(text, ['submitted', 'thanks', 'success', 'modal', 'dialog', 'blocked', 'failed']);
      const passed = hasTest && hasUser && hasResult;
      return { passed, score: (hasTest ? 0.25 : 0) + (hasUser ? 0.25 : 0) + (hasEmail ? 0.25 : 0) + (hasResult ? 0.25 : 0), details: `name=${hasTest && hasUser}, email=${hasEmail}, result=${hasResult}` };
    },
  },

  // ── D. Long Workflows (W11-W12) ──
  {
    id: 'W11',
    name: '工作流 — GitHub issue 三步筛选',
    category: 'workflow',
    dimension: 'workflow',
    task: 'Open https://github.com/microsoft/vscode/issues. The page should already show open issues. Click the "Labels" filter in the toolbar, find and select the "bug" label. Wait for results to update. Then extract the top 3 visible issues. For each output: issue_number (the #1234 form), title, comments_count. Output as JSON array. Output ONLY the JSON, no preamble.',
    theoretical_min_tools: 8,
    options: { include_tools: true },
    timeout_ms: 7 * 60 * 1000,
    validator: (text) => {
      const numbers = (text?.match(/#\d{3,}/g) || []).length;
      const j = v.hasJSONArray(text, 3);
      const passed = numbers >= 3 && j.count >= 3;
      return { passed, score: Math.min(1, (numbers >= 3 ? 0.5 : numbers / 6) + (j.passed ? 0.5 : j.count / 6)), details: `issueRefs=${numbers}, items=${j.count}` };
    },
  },
  {
    id: 'W12',
    name: '工作流 — Stack Overflow 搜索 + 答案抽取',
    category: 'workflow',
    dimension: 'workflow',
    task: 'Open https://stackoverflow.com/search?q=javascript+closure. Click the FIRST question result to open it. On the question page: (1) extract a 1-sentence summary of the question, (2) find the accepted answer (green checkmark), extract the first code block from it, (3) extract a 1-sentence summary of the accepted answer. Output as JSON: {question_summary, answer_code, answer_summary}.',
    theoretical_min_tools: 7,
    options: { include_tools: true },
    timeout_ms: 7 * 60 * 1000,
    validator: (text) => {
      const lower = (text || '').toLowerCase();
      const hasClosure = lower.includes('closure') || lower.includes('scope') || lower.includes('function');
      const hasCode = /```|<code>|function\s*\(|var\s+\w|const\s+\w|=>\s*{/.test(text || '');
      const hasJSON = /\{[\s\S]*"?question[_\s]?summary/i.test(text || '');
      const passed = hasClosure && hasCode && hasJSON;
      return { passed, score: (hasClosure ? 0.35 : 0) + (hasCode ? 0.35 : 0) + (hasJSON ? 0.3 : 0), details: `topic=${hasClosure}, code=${hasCode}, jsonShape=${hasJSON}` };
    },
  },

  // ── E. Devtools (W13-W14) ──
  {
    id: 'W13',
    name: 'Devtools — 网络请求抽取',
    category: 'devtools',
    dimension: 'devtools',
    task: 'Open https://jsonplaceholder.typicode.com/. The page describes a fake REST API. Click the link/anchor for "/posts" or "/posts/1" if present (otherwise navigate to https://jsonplaceholder.typicode.com/posts/1). Wait for the response. Then call read_network_requests and identify the JSON API endpoint that was fetched. Output: HTTP method + full URL + response status code. Format: "METHOD URL → STATUS".',
    theoretical_min_tools: 5,
    options: { include_tools: true },
    timeout_ms: 5 * 60 * 1000,
    validator: (text) => {
      const hasMethod = /\b(GET|POST|PUT|DELETE)\b/.test(text || '');
      const hasURL = /jsonplaceholder/.test(text || '') || v.countURLs(text) >= 1;
      const hasStatus = /\b(200|201|2\d\d|404|3\d\d)\b/.test(text || '');
      const passed = hasMethod && hasURL && hasStatus;
      return { passed, score: (hasMethod ? 0.34 : 0) + (hasURL ? 0.33 : 0) + (hasStatus ? 0.33 : 0), details: `method=${hasMethod}, url=${hasURL}, status=${hasStatus}` };
    },
  },
  {
    id: 'W14',
    name: 'Devtools — 控制台错误抓取',
    category: 'devtools',
    dimension: 'devtools',
    task: 'Open https://example.com. Use javascript_tool to execute this exact code: `setTimeout(() => { throw new Error("test_error_from_perf_W14"); }, 50);` then wait briefly. Then call read_console_messages. Find the error and report: the error message, and the first stack frame (file/line if any). Output format: "Error: <message>; Stack: <first frame>".',
    theoretical_min_tools: 5,
    options: { include_tools: true },
    timeout_ms: 4 * 60 * 1000,
    validator: (text) => {
      const lower = (text || '').toLowerCase();
      const hasError = lower.includes('test_error_from_perf_w14') || lower.includes('test_error') || lower.includes('error:');
      const hasStack = lower.includes('stack') || lower.includes('at ') || lower.includes('.js');
      const passed = hasError && hasStack;
      return { passed, score: (hasError ? 0.6 : 0) + (hasStack ? 0.4 : 0), details: `errMsg=${hasError}, stackFrame=${hasStack}` };
    },
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

// Match scenario by exact id, or by family prefix (e.g. "S8" matches S8-T1/T2/T3
// but NOT "W1" matching W10/W11). Family match requires the matched id to have
// a "-" right after the prefix.
function selectionMatches(scenarioId, sel) {
  return scenarioId === sel || scenarioId.startsWith(sel + '-');
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

  // ── Result-correctness validation ──
  const fullResult = typeof parsed.result === 'string' ? parsed.result : '';
  let validation = null;
  if (typeof scenario.validator === 'function' && completed) {
    try {
      const out = scenario.validator(fullResult, { tools: calls, results });
      validation = {
        passed: !!out?.passed,
        score: typeof out?.score === 'number' ? Math.max(0, Math.min(1, out.score)) : (out?.passed ? 1 : 0),
        details: out?.details || '',
      };
    } catch (e) {
      validation = { passed: false, score: 0, details: `validator threw: ${e.message}` };
    }
  } else if (typeof scenario.validator === 'function') {
    // task didn't complete — automatic fail
    validation = { passed: false, score: 0, details: `task status=${parsed.status}` };
  }

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
    result_text: fullResult.slice(0, 500),  // longer slice for inspection
    full_result_len: fullResult.length,
    validation,
    error: parsed.error || null,
  };
}

async function runOnce(scenario, extraBody = {}) {
  const t0 = performance.now();
  const body = {
    task: scenario.task,
    ...(scenario.options || {}),
    ...extraBody,
  };
  // Only send apiUrl/apiKey/model if explicitly set via env. Otherwise let the
  // sidepanel use its own configured values — sending an empty string would
  // overwrite the sidepanel's saved key with nothing and trigger 401s.
  if (API_URL_OVERRIDE) body.apiUrl = API_URL_OVERRIDE;
  if (API_KEY_OVERRIDE) body.apiKey = API_KEY_OVERRIDE;
  if (MODEL_OVERRIDE) body.model = MODEL_OVERRIDE;
  const timeoutMs = scenario.timeout_ms || FETCH_TIMEOUT_MS;
  let response;
  try {
    response = await fetchWithTimeout(HOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
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
  const validated_runs = ok_runs.filter(r => r.validation);
  const passed_runs = validated_runs.filter(r => r.validation.passed);
  const scores = validated_runs.map(r => r.validation.score);
  return {
    n: runs.length,
    success: ok_runs.length,
    success_rate: runs.length ? ok_runs.length / runs.length : 0,
    // Validator pass rate (only meaningful for scenarios with a validator)
    validated_n: validated_runs.length,
    passed_n: passed_runs.length,
    pass_rate: validated_runs.length ? passed_runs.length / validated_runs.length : null,
    avg_score: scores.length ? fmt(avg(scores)) : null,
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
  log(`\n▶ ${scenario.id}: ${scenario.name}  (n=${n}, cat=${scenario.category || '?'}, dim=${scenario.dimension})`);
  const runs = [];
  for (let i = 1; i <= n; i++) {
    logRaw(`  [${scenario.id} ${i}/${n}] `);
    const r = await runOnce(scenario);
    runs.push(r);
    let summary;
    if (r.ok) {
      const validTag = r.validation
        ? (r.validation.passed ? ' ✓PASS' : ` ✗FAIL(score=${r.validation.score.toFixed(2)})`)
        : '';
      summary = `✓ rtt=${Math.round(r.rtt_ms)}ms tools=${r.total_tools} rp=${r.read_page_count} ss=${r.screenshot_count} click=${r.click_count} red=${r.redundant_calls}${validTag}`;
    } else {
      summary = `✗ rtt=${Math.round(r.rtt_ms)}ms ERR=${(r.error || r.status || '').slice(0, 60)}`;
    }
    log(summary);
    if (i < n) await new Promise(rs => setTimeout(rs, INTER_RUN_DELAY_MS));
  }
  let stats = computeStats(runs);

  if (n < N_LONGTAIL && stats.rtt_p50 > 0 && stats.rtt_p95 / stats.rtt_p50 > 3 && !scenario.validator) {
    // Long-tail extension only for atomic scenarios (no validator). Workflow
    // scenarios are too slow/expensive to extend automatically.
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
  return {
    id: scenario.id,
    name: scenario.name,
    category: scenario.category || 'atomic',
    dimension: scenario.dimension,
    theoretical_min_tools: scenario.theoretical_min_tools,
    decisiveness: !!scenario.decisiveness,
    has_validator: typeof scenario.validator === 'function',
    stats,
    runs,
  };
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
  const passLine = (s.pass_rate != null)
    ? `- **Validator**: passed ${s.passed_n}/${s.validated_n} (${(s.pass_rate * 100).toFixed(0)}%), avg score=${s.avg_score}\n`
    : '';
  return `### ${r.id} — ${r.name}

- 维度: \`${r.dimension}\`  |  分类: \`${r.category || 'atomic'}\`
- 理论最小 tool 调用: ${r.theoretical_min_tools}
- N: ${s.n}, 成功: ${s.success}, 成功率: ${(s.success_rate * 100).toFixed(1)}%
${passLine}- **RTT**: p50=**${s.rtt_p50}ms**, p95=**${s.rtt_p95}ms**, avg=${s.rtt_avg}ms, min=${s.rtt_min}ms, max=${s.rtt_max}ms
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
  let md = `## 总览（端到端 RTT + 工具开销 + 校验通过）\n\n`;
  md += `| ID | 分类 | n | 成功率 | 校验通过 | avg score | RTT p50 | RTT p95 | avg tools | redundant |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of allResults) {
    if (!r.stats) continue;
    const s = r.stats;
    const validated = s.pass_rate != null ? `${s.passed_n}/${s.validated_n} (${(s.pass_rate * 100).toFixed(0)}%)` : '—';
    const score = s.avg_score != null ? s.avg_score : '—';
    md += `| ${r.id} | ${r.category || 'atomic'} | ${s.n} | ${(s.success_rate * 100).toFixed(0)}% | ${validated} | ${score} | ${s.rtt_p50}ms | ${s.rtt_p95}ms | ${s.avg_total_tools} | ${s.avg_redundant} |\n`;
  }
  md += `\n`;
  return md;
}

function mdCategorySummary(allResults) {
  // Aggregate per-category pass rate, avg RTT, avg tool count
  const byCat = {};
  for (const r of allResults) {
    if (!r.stats) continue;
    const cat = r.category || 'atomic';
    if (!byCat[cat]) byCat[cat] = { scenarios: 0, total_runs: 0, validated: 0, passed: 0, scores: [], rtts: [], tools: [] };
    byCat[cat].scenarios++;
    byCat[cat].total_runs += r.stats.n;
    if (r.stats.validated_n) {
      byCat[cat].validated += r.stats.validated_n;
      byCat[cat].passed += r.stats.passed_n;
      if (r.stats.avg_score != null) byCat[cat].scores.push(r.stats.avg_score);
    }
    byCat[cat].rtts.push(r.stats.rtt_p50);
    byCat[cat].tools.push(r.stats.avg_total_tools);
  }
  let md = `## 分类汇总\n\n`;
  md += `| 分类 | 场景数 | 总运行数 | 校验通过 | 平均 score | 平均 p50 RTT | 平均 tools |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  const order = ['atomic', 'extraction', 'manipulation', 'forms', 'workflow', 'devtools', 'decisiveness'];
  const sorted = Object.keys(byCat).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const cat of sorted) {
    const c = byCat[cat];
    const passLine = c.validated ? `${c.passed}/${c.validated} (${(c.passed / c.validated * 100).toFixed(0)}%)` : '—';
    const score = c.scores.length ? fmt(avg(c.scores)) : '—';
    md += `| ${cat} | ${c.scenarios} | ${c.total_runs} | ${passLine} | ${score} | ${Math.round(avg(c.rtts))}ms | ${fmt(avg(c.tools))} |\n`;
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
    !SELECTED || SELECTED.some(sel => selectionMatches(s.id, sel))
  );

  for (const scenario of standardScenarios) {
    // Per-scenario N: explicit override > category default > CLI N
    const scenarioN = scenario.n_override
      ?? (argMap.n ? N : (scenario.category ? defaultNForCategory(scenario.category) : N));
    try {
      const r = await runStandardScenario(scenario, scenarioN);
      results.push(r);
    } catch (e) {
      log(`  ✗ ${scenario.id} threw: ${e.message} — continuing`);
      results.push({ id: scenario.id, name: scenario.name, category: scenario.category, dimension: scenario.dimension, error: e.message });
      // Don't throw — let the rest of the suite run. Errored scenario is in results with .error.
    }
  }

  // S6 + S7 (manual)
  if (!SKIP_MANUAL) {
    if (!SELECTED || SELECTED.some(sel => selectionMatches('S6', sel))) {
      try { results.push(await runS6()); }
      catch (e) { log(`  ✗ S6 threw: ${e.message}`); results.push({ id: 'S6', error: e.message }); throw e; }
    }
    if (!SELECTED || SELECTED.some(sel => selectionMatches('S7', sel))) {
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
  md += mdCategorySummary(results);
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
