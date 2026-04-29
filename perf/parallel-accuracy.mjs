#!/usr/bin/env node

import { createServer } from 'node:http';

const HOST = process.env.CLAWLINE_TEST_HOST || '127.0.0.1';
const TEST_PORT = Number(process.env.CLAWLINE_TEST_PORT || 49218);
const HOOK_URL = process.env.CLAWLINE_HOOK_URL || 'http://127.0.0.1:4821';
const ONLY = process.env.CLAWLINE_TEST_ONLY || '';

const TESTS = [
  {
    id: 'form-wizard',
    title: 'Form Wizard',
    path: '/form-wizard',
    expected: 'wizard:confirmed:Lin:Pro:email',
    task: (url) => `Navigate to ${url}. Complete the two-step wizard: set Full name to "Lin", choose plan "Pro", click Next, set Email to "lin@example.com", click Confirm. Use read_page and ref-based actions. At the end read the page text and report PASS only if it contains "wizard:confirmed:Lin:Pro:email".`,
  },
  {
    id: 'todo-filter',
    title: 'Todo Filter',
    path: '/todo-filter',
    expected: 'todo:active=2;done=1;items=alpha,gamma',
    task: (url) => `Navigate to ${url}. Add todos "alpha", "beta", and "gamma" using the input and Add button. Mark "beta" complete. Click the Active filter. Read the page text and report PASS only if it contains "todo:active=2;done=1;items=alpha,gamma".`,
  },
  {
    id: 'menu-search',
    title: 'Menu Search',
    path: '/menu-search',
    expected: 'menu:selected=settings;query=agent',
    task: (url) => `Navigate to ${url}. Click the Menu button, choose Settings, type "agent" in the search box, then click Apply. Use ref-based clicks. Read the final page text and report PASS only if it contains "menu:selected=settings;query=agent".`,
  },
  {
    id: 'table-sort',
    title: 'Table Sort',
    path: '/table-sort',
    expected: 'table:first=Ada;filter=ready;count=2',
    task: (url) => `Navigate to ${url}. Execute this exact short flow: (1) call read_page with filter="interactive"; (2) use form_input on the Status combobox to set it to "ready"; (3) use ref-based computer left_click on the "Sort by Name" button; (4) call get_page_text. Do not use screenshots, JavaScript, console, network, or extra investigation. Report PASS only if the text contains exactly "table:first=Ada;filter=ready;count=2".`,
  },
];

function selectedTests() {
  if (!ONLY) return TESTS;
  const wanted = new Set(ONLY.split(',').map(s => s.trim()).filter(Boolean));
  return TESTS.filter(test => wanted.has(test.id));
}

function pageShell(title, body, script) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; line-height: 1.5; }
    button, input, select { font-size: 16px; margin: 6px; padding: 8px; }
    .panel { border: 1px solid #ccc; padding: 12px; max-width: 720px; }
    .done { text-decoration: line-through; color: #666; }
    table { border-collapse: collapse; margin-top: 12px; }
    td, th { border: 1px solid #ccc; padding: 6px 10px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="panel">${body}</div>
  <pre id="result">idle</pre>
  <script>${script}</script>
</body>
</html>`;
}

function renderTest(path) {
  if (path === '/form-wizard') {
    return pageShell('Form Wizard', `
      <div id="step1">
        <label>Full name <input id="name" placeholder="Full name"></label>
        <label>Plan <select id="plan"><option>Basic</option><option>Pro</option><option>Team</option></select></label>
        <button id="next">Next</button>
      </div>
      <div id="step2" hidden>
        <label>Email <input id="email" placeholder="Email"></label>
        <button id="confirm">Confirm</button>
      </div>`, `
      next.onclick = () => { step1.hidden = true; step2.hidden = false; };
      confirm.onclick = () => { result.textContent = 'wizard:confirmed:' + name.value + ':' + plan.value + ':' + (email.value.includes('@') ? 'email' : 'invalid'); };
    `);
  }
  if (path === '/todo-filter') {
    return pageShell('Todo Filter', `
      <label>Todo <input id="todo" placeholder="Todo"></label><button id="add">Add</button>
      <div id="list"></div>
      <button id="showActive">Active</button>`, `
      const todos = [];
      function render(activeOnly = false) {
        list.innerHTML = '';
        todos.filter(t => !activeOnly || !t.done).forEach((t, i) => {
          const row = document.createElement('div');
          row.innerHTML = '<label><input type="checkbox" data-i="' + i + '" ' + (t.done ? 'checked' : '') + '> <span class="' + (t.done ? 'done' : '') + '">' + t.text + '</span></label>';
          row.querySelector('input').onchange = (event) => { t.done = event.target.checked; render(activeOnly); };
          list.appendChild(row);
        });
        const active = todos.filter(t => !t.done).map(t => t.text);
        result.textContent = 'todo:active=' + active.length + ';done=' + todos.filter(t => t.done).length + ';items=' + active.join(',');
      }
      add.onclick = () => { if (todo.value.trim()) todos.push({ text: todo.value.trim(), done: false }); todo.value = ''; render(false); };
      showActive.onclick = () => render(true);
    `);
  }
  if (path === '/menu-search') {
    return pageShell('Menu Search', `
      <button id="menu" aria-expanded="false">Menu</button>
      <div id="items" hidden><button id="settings">Settings</button><button id="billing">Billing</button></div>
      <label>Search <input id="search" placeholder="Search"></label>
      <button id="apply">Apply</button>`, `
      let selected = 'none';
      menu.onclick = () => { items.hidden = !items.hidden; menu.setAttribute('aria-expanded', String(!items.hidden)); };
      settings.onclick = () => { selected = 'settings'; items.hidden = true; };
      billing.onclick = () => { selected = 'billing'; items.hidden = true; };
      apply.onclick = () => { result.textContent = 'menu:selected=' + selected + ';query=' + search.value; };
    `);
  }
  if (path === '/table-sort') {
    return pageShell('Table Sort', `
      <label>Status <select id="status"><option value="all">all</option><option value="ready">ready</option><option value="blocked">blocked</option></select></label>
      <button id="sortName">Sort by Name</button>
      <table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table>`, `
      const data = [{ name: 'Zoe', status: 'ready' }, { name: 'Ada', status: 'ready' }, { name: 'Mia', status: 'blocked' }];
      let filtered = data.slice();
      function render() {
        rows.innerHTML = filtered.map(r => '<tr><td>' + r.name + '</td><td>' + r.status + '</td></tr>').join('');
        result.textContent = 'table:first=' + (filtered[0]?.name || '') + ';filter=' + status.value + ';count=' + filtered.length;
      }
      status.onchange = () => { filtered = data.filter(r => status.value === 'all' || r.status === status.value); render(); };
      sortName.onclick = () => { filtered.sort((a, b) => a.name.localeCompare(b.name)); render(); };
      render();
    `);
  }
  return pageShell('Index', TESTS.map(t => `<p><a href="${t.path}">${t.title}</a></p>`).join(''), '');
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}:${TEST_PORT}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderTest(url.pathname));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(TEST_PORT, HOST, () => resolve(server));
  });
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: { raw: text } }; }
}

async function main() {
  const server = await startServer();
  console.log(`[server] http://${HOST}:${TEST_PORT}`);
  try {
    const sessionsRes = await jsonFetch(`${HOOK_URL}/sessions`);
    const sessions = (sessionsRes.data.sessions || []).filter(s => !s.busy);
    console.log(`[sessions] ${sessions.length} available`);
    for (const s of sessions) {
      console.log(`- window=${s.windowId} sidepanelTab=${s.sidepanelTabId || 'unknown'} ${s.sidepanelTab?.title || s.activeTab?.title || ''}`);
    }
    const tests = selectedTests();
    if (tests.length === 0) {
      console.log(`[blocked] No tests matched CLAWLINE_TEST_ONLY=${ONLY}`);
      process.exitCode = 2;
      return;
    }
    if (sessions.length < tests.length) {
      console.log(`[blocked] Need at least ${tests.length} sidepanel windows. Open sidepanel in enough browser windows, then rerun this script.`);
      process.exitCode = 2;
      return;
    }

    const startedAt = Date.now();
    const jobs = tests.map((test, index) => {
      const session = sessions[index];
      const url = `http://${HOST}:${TEST_PORT}${test.path}`;
      const body = JSON.stringify({
        windowId: session.windowId,
        include_tools: true,
        include_screenshot: false,
        task: test.task(url),
      });
      return jsonFetch(`${HOOK_URL}/hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }).then(result => ({ test, session, result })).catch(error => ({ test, session, error }));
    });
    const results = await Promise.all(jobs);
    console.log(`\n[results] ${Date.now() - startedAt}ms`);
    let passed = 0;
    for (const { test, session, result, error } of results) {
      if (error) {
        console.log(`FAIL ${test.id} window=${session.windowId}: ${error.message}`);
        continue;
      }
      const data = result.data;
      const toolTexts = (data.tools || []).flatMap(t => t.texts || []).join('\n');
      const ok = data.status === 'completed' && ((data.result || '').includes('PASS') || toolTexts.includes(test.expected));
      if (ok) passed++;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${test.id} window=${session.windowId} tab=${data.tabId || 'unknown'} status=${data.status}`);
      console.log(`  result: ${(data.result || data.error || '').replace(/\s+/g, ' ').slice(0, 220)}`);
      console.log(`  tools: ${(data.tools || []).filter(t => t.type === 'call').map(t => t.name).join(' -> ')}`);
    }
    console.log(`\nsummary: ${passed}/${tests.length} passed`);
    if (passed !== tests.length) process.exitCode = 1;
  } finally {
    server.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});