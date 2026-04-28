#!/usr/bin/env node
/**
 * Clawline host discovery — scan localhost ports, aggregate all running hosts.
 *
 * Usage:
 *   node perf/discover.mjs           # pretty-print
 *   node perf/discover.mjs --json    # machine-readable JSON
 *   node perf/discover.mjs --ports 4821-4830   # custom range
 *
 * Useful for:
 *   - browser-agent skill preflight (find available agents)
 *   - debugging multi-profile setups (which host binds which port)
 *   - perf harness targeting (pick a specific window by title/url)
 */

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
let portRange = [4821, 4830];
const rangeIdx = args.indexOf('--ports');
if (rangeIdx >= 0 && args[rangeIdx + 1]) {
  const parts = args[rangeIdx + 1].split('-').map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) portRange = parts;
}

const TIMEOUT_MS = 500;

async function probePort(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.name !== 'clawline-hook') return null;
    return { port, ok: true, ...data };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function main() {
  const [start, end] = portRange;
  const probes = [];
  for (let p = start; p <= end; p++) probes.push(probePort(p));
  const results = (await Promise.all(probes)).filter(Boolean);

  if (jsonOutput) {
    console.log(JSON.stringify({ hosts: results }, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No Clawline hosts found on ports ${start}-${end}.`);
    console.log(`Make sure Chrome is running with the extension loaded and side panel opened.`);
    process.exit(1);
  }

  console.log(`Found ${results.length} Clawline host(s) on ports ${start}-${end}:\n`);
  let legacyCount = 0;
  for (const h of results) {
    const isLegacy = h.pid === undefined || h.hostStartedAt === undefined;
    if (isLegacy) legacyCount++;
    const age = h.hostStartedAt ? `up ${fmtDuration(Date.now() - new Date(h.hostStartedAt).getTime())}` : '';
    const legacyTag = isLegacy ? '  [legacy build — restart extension to see full info]' : '';
    console.log(`  Port ${h.port}  pid=${h.pid ?? '?'}  ${h.chromeConnected ? '✓ connected' : '✗ not connected'}  ${age}${legacyTag}`);
    if (h.extensionName) {
      console.log(`    ext:      ${h.extensionName} ${h.extensionVersion || ''}`);
    }
    console.log(`    pending:  ${h.pendingTasks} task(s)`);
    const wins = h.windows || [];
    if (wins.length === 0) {
      console.log(`    windows:  ${isLegacy ? '(unknown — legacy host)' : '(none — side panel not opened)'}`);
    } else {
      console.log(`    windows:  ${wins.length}`);
      for (const w of wins) {
        const focus = w.focused ? ' [focused]' : '';
        const incog = w.incognito ? ' [incognito]' : '';
        const busy = w.busy ? ' [BUSY]' : ' [idle]';
        const tabs = typeof w.tabCount === 'number' ? `${w.tabCount} tab(s)` : '';
        console.log(`      windowId=${w.windowId}${focus}${incog}${busy}  ${tabs}`);
        if (Array.isArray(w.runningTasks) && w.runningTasks.length) {
          for (const rt of w.runningTasks) {
            const dur = typeof rt.runningMs === 'number' ? `${Math.round(rt.runningMs / 1000)}s` : '?';
            console.log(`          running: ${rt.taskId}  (${dur})`);
          }
        }
        const tabList = Array.isArray(w.tabs) ? w.tabs : (w.activeTab ? [w.activeTab] : []);
        for (const t of tabList) {
          const marker = t.active ? '●' : '○';
          const pinned = t.pinned ? ' 📌' : '';
          console.log(`        ${marker} tabId=${t.id}${pinned}  "${t.title}"`);
          console.log(`            ${t.url}`);
        }
      }
    }
    console.log('');
  }
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

main().catch((e) => {
  console.error('discover failed:', e.message);
  process.exit(1);
});
