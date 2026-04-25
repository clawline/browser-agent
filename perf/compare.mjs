#!/usr/bin/env node
/**
 * Compare two perf-reports run dirs and produce a Markdown delta report.
 *
 * Usage:
 *   node perf/compare.mjs <before-dir> <after-dir>
 *   node perf/compare.mjs perf-reports/2026-04-25_..._v0 perf-reports/..._v1
 *
 * Output is written to stdout (pipe to a file if you want to save):
 *   node perf/compare.mjs v0 v1 > perf-reports/compare.md
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.length < 4) {
  console.error('Usage: node perf/compare.mjs <before-dir> <after-dir>');
  process.exit(1);
}

const beforeDir = process.argv[2];
const afterDir = process.argv[3];

function load(dir) {
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf-8'));
  const byId = {};
  for (const r of summary.results) {
    if (r.stats) byId[r.id] = r;
  }
  return { env: summary.env, byId, raw: summary.results };
}

const before = load(beforeDir);
const after = load(afterDir);

function pctDelta(before, after) {
  if (!before || before === 0) return null;
  return ((after - before) / before) * 100;
}

function fmtDelta(d) {
  if (d == null) return 'n/a';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

function arrow(delta, betterIsLower = true) {
  if (delta == null) return '';
  const eps = 0.5;
  if (Math.abs(delta) < eps) return '≈';
  if (betterIsLower) return delta < 0 ? '↓ better' : '↑ worse';
  return delta > 0 ? '↑ better' : '↓ worse';
}

const ids = [...new Set([...Object.keys(before.byId), ...Object.keys(after.byId)])].sort();

console.log(`# Perf Comparison: ${beforeDir} → ${afterDir}\n`);
console.log(`- Before: ${before.env.timestamp}`);
console.log(`- After:  ${after.env.timestamp}\n`);

// ── Per-scenario detail ──
console.log(`## Per-scenario\n`);
console.log(`| ID | Cat | RTT p50 (before → after) | Δ | tools (b → a) | Δ tools | redundant (b → a) | pass% (b → a) |`);
console.log(`|---|---|---|---|---|---|---|---|`);

const scenarioDeltas = [];
for (const id of ids) {
  const b = before.byId[id];
  const a = after.byId[id];
  if (!b || !a || !b.stats || !a.stats) {
    console.log(`| ${id} | ${(a || b)?.category || '?'} | ${b ? b.stats?.rtt_p50 + 'ms' : '—'} → ${a ? a.stats?.rtt_p50 + 'ms' : '—'} | n/a | — | n/a | — | — |`);
    continue;
  }
  const dRTT = pctDelta(b.stats.rtt_p50, a.stats.rtt_p50);
  const dTools = pctDelta(b.stats.avg_total_tools, a.stats.avg_total_tools);
  const dRed = pctDelta(b.stats.avg_redundant, a.stats.avg_redundant);
  const bPass = b.stats.pass_rate != null ? `${(b.stats.pass_rate * 100).toFixed(0)}%` : '—';
  const aPass = a.stats.pass_rate != null ? `${(a.stats.pass_rate * 100).toFixed(0)}%` : '—';
  scenarioDeltas.push({ id, category: a.category, dRTT, dTools, dRed, b, a });
  console.log(`| ${id} | ${a.category || 'atomic'} | ${b.stats.rtt_p50}ms → ${a.stats.rtt_p50}ms | **${fmtDelta(dRTT)}** ${arrow(dRTT)} | ${b.stats.avg_total_tools} → ${a.stats.avg_total_tools} | ${fmtDelta(dTools)} ${arrow(dTools)} | ${b.stats.avg_redundant} → ${a.stats.avg_redundant} | ${bPass} → ${aPass} |`);
}

// ── Category aggregates ──
console.log(`\n## Per-category aggregates\n`);
const cats = {};
for (const sd of scenarioDeltas) {
  const c = sd.category || 'atomic';
  if (!cats[c]) cats[c] = { rtts_b: [], rtts_a: [], tools_b: [], tools_a: [] };
  cats[c].rtts_b.push(sd.b.stats.rtt_p50);
  cats[c].rtts_a.push(sd.a.stats.rtt_p50);
  cats[c].tools_b.push(sd.b.stats.avg_total_tools);
  cats[c].tools_a.push(sd.a.stats.avg_total_tools);
}
console.log(`| Category | scenarios | avg RTT before → after | Δ RTT | avg tools b → a | Δ tools |`);
console.log(`|---|---|---|---|---|---|`);
const order = ['atomic', 'extraction', 'manipulation', 'forms', 'workflow', 'devtools', 'decisiveness'];
const sorted = Object.keys(cats).sort((x, y) => order.indexOf(x) - order.indexOf(y));
for (const c of sorted) {
  const cc = cats[c];
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const rb = avg(cc.rtts_b), ra = avg(cc.rtts_a);
  const tb = avg(cc.tools_b), ta = avg(cc.tools_a);
  console.log(`| ${c} | ${cc.rtts_b.length} | ${Math.round(rb)}ms → ${Math.round(ra)}ms | **${fmtDelta(pctDelta(rb, ra))}** ${arrow(pctDelta(rb, ra))} | ${tb.toFixed(2)} → ${ta.toFixed(2)} | ${fmtDelta(pctDelta(tb, ta))} ${arrow(pctDelta(tb, ta))} |`);
}

// ── Overall ──
console.log(`\n## Overall\n`);
const allBeforeRTT = scenarioDeltas.map(s => s.b.stats.rtt_p50);
const allAfterRTT = scenarioDeltas.map(s => s.a.stats.rtt_p50);
const allBeforeTools = scenarioDeltas.map(s => s.b.stats.avg_total_tools);
const allAfterTools = scenarioDeltas.map(s => s.a.stats.avg_total_tools);

const meanRTTBefore = allBeforeRTT.reduce((s, x) => s + x, 0) / allBeforeRTT.length;
const meanRTTAfter = allAfterRTT.reduce((s, x) => s + x, 0) / allAfterRTT.length;
const meanToolsBefore = allBeforeTools.reduce((s, x) => s + x, 0) / allBeforeTools.length;
const meanToolsAfter = allAfterTools.reduce((s, x) => s + x, 0) / allAfterTools.length;

const overallRTTDelta = pctDelta(meanRTTBefore, meanRTTAfter);
const overallToolsDelta = pctDelta(meanToolsBefore, meanToolsAfter);

console.log(`- Scenarios compared: ${scenarioDeltas.length}`);
console.log(`- **Mean RTT p50**: ${Math.round(meanRTTBefore)}ms → ${Math.round(meanRTTAfter)}ms (**${fmtDelta(overallRTTDelta)}** ${arrow(overallRTTDelta)})`);
console.log(`- **Mean tools per task**: ${meanToolsBefore.toFixed(2)} → ${meanToolsAfter.toFixed(2)} (**${fmtDelta(overallToolsDelta)}** ${arrow(overallToolsDelta)})`);

// Pass-rate aggregate (validated scenarios only)
const validated = scenarioDeltas.filter(s => s.b.stats.pass_rate != null && s.a.stats.pass_rate != null);
if (validated.length) {
  const pBefore = validated.reduce((s, x) => s + x.b.stats.passed_n, 0) / validated.reduce((s, x) => s + x.b.stats.validated_n, 0);
  const pAfter = validated.reduce((s, x) => s + x.a.stats.passed_n, 0) / validated.reduce((s, x) => s + x.a.stats.validated_n, 0);
  console.log(`- **Validator pass rate**: ${(pBefore * 100).toFixed(0)}% → ${(pAfter * 100).toFixed(0)}% (Δ ${((pAfter - pBefore) * 100).toFixed(1)} pts)`);
}

// Verdict
console.log(`\n## Verdict\n`);
if (overallRTTDelta != null && overallRTTDelta <= -20) {
  console.log(`✅ **Hit ≥ 20% RTT improvement target** (${fmtDelta(overallRTTDelta)})`);
} else if (overallRTTDelta != null && overallRTTDelta < 0) {
  console.log(`⚠ Improvement ${fmtDelta(overallRTTDelta)} — below the 20% target`);
} else {
  console.log(`❌ No improvement — ${fmtDelta(overallRTTDelta)}`);
}

// Top movers
console.log(`\n### Top RTT improvements\n`);
const sortedByRTTDelta = scenarioDeltas.filter(s => s.dRTT != null).sort((a, b) => a.dRTT - b.dRTT).slice(0, 5);
for (const s of sortedByRTTDelta) {
  console.log(`- **${s.id}** (${s.category}): ${s.b.stats.rtt_p50}ms → ${s.a.stats.rtt_p50}ms (**${fmtDelta(s.dRTT)}**)`);
}

console.log(`\n### Top RTT regressions\n`);
const regressions = scenarioDeltas.filter(s => s.dRTT != null && s.dRTT > 5).sort((a, b) => b.dRTT - a.dRTT).slice(0, 5);
if (regressions.length === 0) console.log(`(none)`);
for (const s of regressions) {
  console.log(`- **${s.id}** (${s.category}): ${s.b.stats.rtt_p50}ms → ${s.a.stats.rtt_p50}ms (**${fmtDelta(s.dRTT)}**)`);
}
