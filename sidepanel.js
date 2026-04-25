/* Clawline Browser Agent — Full browser automation sidepanel
 * Replicates the Claude Chrome extension's tool system and agent loop.
 * Tools: read_page, find, form_input, computer, navigate, get_page_text,
 *        tabs_create, tabs_context, read_console_messages, read_network_requests,
 *        resize_window, javascript_tool
 * API: Configurable endpoint → Anthropic Messages API
 */

let API_URL = 'http://127.0.0.1:4819';
let API_KEY = '';
const MAX_TOKENS = 10000;

// ── Hook: connect to service worker immediately ──
// (Placed early so it runs even if later code has errors)
let swPort = null;
let activeHookTaskId = null;
let currentWindowId = null; // This sidepanel's window — used by getTargetTab()
let _reconnectAttempts = 0;
const _RECONNECT_MAX_RETRIES = 20;
const _RECONNECT_MAX_DELAY = 30000;

(function initHookConnection() {
  try {
    swPort = chrome.runtime.connect({ name: 'sidepanel' });
    _reconnectAttempts = 0; // Reset on successful connect
    console.log('[clawline-hook] port connected');

    (async () => {
      let windowId = null;
      try { windowId = (await chrome.windows.getCurrent()).id; } catch {}
      if (!windowId) try { windowId = (await chrome.windows.getLastFocused()).id; } catch {}
      if (!windowId) try { const t = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (t[0]) windowId = t[0].windowId; } catch {}
      if (!windowId) windowId = 'sp_' + Date.now();
      currentWindowId = windowId;
      console.log('[clawline-hook] register windowId:', windowId);
      swPort.postMessage({ type: 'register', windowId });
    })();

    swPort.onMessage.addListener((msg) => {
      // Update hook bridge status indicator
      if (msg.type === 'hook_status') {
        if (msg.connected && !hookConnected) hookLogAdd('info', 'Bridge connected' + (msg.port ? ` (port ${msg.port})` : ''));
        else if (!msg.connected && hookConnected) hookLogAdd('err', 'Bridge disconnected');
        if (typeof msg.port === 'number') hookHostPort = msg.port;
        else if (msg.connected === false) hookHostPort = null;
        updateHookStatus(msg.connected);
        return;
      }
      // handleHookMessage is defined later in the file
      if (typeof handleHookMessage === 'function') handleHookMessage(msg);
    });
    swPort.onDisconnect.addListener(() => {
      console.log('[clawline-hook] port disconnected, reconnecting...');
      swPort = null;
      updateHookStatus(false);
      _reconnectAttempts++;
      if (_reconnectAttempts > _RECONNECT_MAX_RETRIES) {
        console.error('[clawline-hook] max reconnect attempts reached, giving up');
        return;
      }
      const delay = Math.min(1000 * Math.pow(2, _reconnectAttempts - 1), _RECONNECT_MAX_DELAY);
      console.log(`[clawline-hook] reconnect attempt ${_reconnectAttempts}/${_RECONNECT_MAX_RETRIES} in ${delay}ms`);
      setTimeout(initHookConnection, delay);
    });
  } catch (e) {
    console.error('[clawline-hook] connect failed:', e);
    swPort = null;
  }
})();

// ── Error logging — capture and send to native host via service worker ──

// ── Hook Bridge Status Indicator & Panel ──
let hookConnected = false;
let hookHostPort = null; // native host's bound HTTP port (sent via hook_status)
const hookStats = { done: 0, error: 0 };
const hookLog = []; // { time, icon, text }
const HOOK_LOG_MAX = 50;

function hookLogAdd(icon, text) {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  hookLog.unshift({ time, icon, text });
  if (hookLog.length > HOOK_LOG_MAX) hookLog.pop();
  renderBridgePanel();
}

function updateHookStatus(connected, active) {
  hookConnected = connected;
  const el = document.getElementById('hook-status');
  const label = document.getElementById('hook-label');
  if (!el) return;
  el.classList.remove('connected', 'active');
  if (active) {
    el.classList.add('active');
    el.title = 'Hook Bridge: task running';
    label.textContent = 'Running';
  } else if (connected) {
    el.classList.add('connected');
    el.title = 'Hook Bridge: connected';
    label.textContent = 'Bridge';
  } else {
    el.title = 'Hook Bridge: disconnected';
    label.textContent = 'Offline';
  }
  renderBridgePanel();
}

function renderBridgePanel() {
  // Connection status
  const hookVal = document.getElementById('bp-hook-val');
  const portVal = document.getElementById('bp-port-val');
  const apiVal = document.getElementById('bp-api-val');
  const taskStats = document.getElementById('bp-task-stats');
  const logEl = document.getElementById('bp-log');
  if (!hookVal) return;

  hookVal.textContent = hookConnected ? 'Connected' : 'Disconnected';
  hookVal.className = 'bp-val ' + (hookConnected ? 'bp-on' : 'bp-off');

  if (portVal) {
    portVal.textContent = hookHostPort != null ? String(hookHostPort) : '—';
    portVal.className = 'bp-val ' + (hookHostPort != null ? 'bp-on' : 'bp-off');
  }

  // API status — show current URL, ping later
  const apiHost = API_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  apiVal.textContent = apiHost;
  apiVal.className = 'bp-val bp-on'; // assume OK if configured

  taskStats.textContent = `${hookStats.done} done / ${hookStats.error} err`;

  // Log
  logEl.innerHTML = hookLog.map(e => {
    const iconCls = { ok: 'ok', err: 'err', run: 'run', info: 'info' }[e.icon] || 'info';
    const iconChar = { ok: '\u2713', err: '\u2717', run: '\u25B6', info: '\u2022' }[e.icon] || '\u2022';
    return `<div class="bp-log-item"><span class="bp-log-time">${e.time}</span><span class="bp-log-icon ${iconCls}">${iconChar}</span><span class="bp-log-text">${escapeHtml(e.text)}</span></div>`;
  }).join('');
}

// ── Error logging ──
let _lastErrKey = '', _lastErrTime = 0;

function sendErrorLog(error) {
  if (!swPort) return;
  const key = String(error.message || error);
  const now = Date.now();
  if (key === _lastErrKey && now - _lastErrTime < 5000) return;
  _lastErrKey = key;
  _lastErrTime = now;
  try {
    swPort.postMessage({
      type: 'error_log',
      error: {
        message: key,
        source: error.source || error.filename || '',
        line: error.lineno || error.line || 0,
        col: error.colno || error.col || 0,
        stack: error.stack || error.error?.stack || '',
        timestamp: new Date().toISOString(),
        from: 'sidepanel',
      },
    });
  } catch {}
}

// Force-write an API failure to native-host error.log, bypassing the 5s dedupe
// in sendErrorLog so back-to-back failures with the same message still surface.
function reportApiError(message, detail) {
  if (!swPort) return;
  try {
    swPort.postMessage({
      type: 'error_log',
      error: {
        message: `[api] ${message}` + (detail ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}` : ''),
        timestamp: new Date().toISOString(),
        from: 'sidepanel-api',
      },
    });
  } catch {}
}

window.addEventListener('error', (e) => {
  sendErrorLog({ message: e.message, source: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error?.stack || '' });
});

window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  sendErrorLog({
    message: 'Unhandled Promise rejection: ' + (err?.message || String(err)),
    stack: err?.stack || '',
  });
});

const FAST_MODEL = 'claude-haiku-4-5-20251001';
const THINKING_BUDGET = 10000;

// ── Conversation Storage (IndexedDB — no size limit, survives extension reloads) ──

const IDB_NAME = 'clawline-agent';
const IDB_VERSION = 1;
const IDB_STORE = 'kv';

let _dbInstance = null;
function getDB() {
  if (_dbInstance) return Promise.resolve(_dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => {
      _dbInstance = req.result;
      _dbInstance.onclose = () => { _dbInstance = null; };
      resolve(_dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let allConversations = {};
let activeConvId = null;

function stripForStorage(convs) {
  const stripped = {};
  for (const [id, conv] of Object.entries(convs)) {
    stripped[id] = {
      ...conv,
      messages: conv.messages.map(msg => {
        if (!Array.isArray(msg.content)) return msg;
        return { ...msg, content: msg.content.map(block => {
          if (block.type === 'image') return { type: 'text', text: '[screenshot]' };
          if (block.type === 'tool_result' && Array.isArray(block.content)) {
            return { ...block, content: block.content.map(b => b.type === 'image' ? { type: 'text', text: '[screenshot]' } : b) };
          }
          return block;
        }) };
      }),
    };
  }
  return stripped;
}

async function loadConversations() {
  try {
    let data = await idbGet('conversations');
    let activeId = await idbGet('activeConvId');

    // One-time migration from chrome.storage.local
    if (!data) {
      const old = await new Promise(r => chrome.storage.local.get(['conversations', 'activeConvId'], r));
      if (old?.conversations && Object.keys(old.conversations).length > 0) {
        data = old.conversations;
        activeId = old.activeConvId;
        await idbSet('conversations', data);
        await idbSet('activeConvId', activeId);
        chrome.storage.local.remove(['conversations', 'activeConvId']);
      }
    }

    allConversations = data || {};
    activeConvId = activeId || null;
  } catch (e) {
    console.warn('Failed to load conversations:', e);
    allConversations = {};
    activeConvId = null;
  }
}

function saveConversations() {
  const stripped = stripForStorage(allConversations);
  idbSet('conversations', stripped).catch(e => console.warn('Save conversations failed:', e));
  idbSet('activeConvId', activeConvId).catch(e => console.warn('Save activeConvId failed:', e));
}

function createConversation(tabId) {
  const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  allConversations[id] = {
    id,
    title: 'New conversation',
    messages: [],
    displayMessages: [],
    updatedAt: Date.now(),
    tabId: typeof tabId === 'number' ? tabId : null,
  };
  activeConvId = id;
  saveConversations();
  return id;
}

function getActiveConv() {
  if (!activeConvId || !allConversations[activeConvId]) createConversation();
  return allConversations[activeConvId];
}

function updateConvTitle(conv) {
  const firstUser = conv.messages.find(m => m.role === 'user');
  if (firstUser) {
    const text = typeof firstUser.content === 'string' ? firstUser.content : firstUser.content?.find(b => b.type === 'text')?.text || '';
    conv.title = text.slice(0, 60) || 'New conversation';
  }
}

function saveCurrentState() {
  const conv = getActiveConv();
  conv.messages = conversation;
  conv.displayMessages = sanitizeHtml(messagesEl.innerHTML).replace(/src="data:image\/[^"]+"/g, 'src=""');
  conv.updatedAt = Date.now();
  updateConvTitle(conv);
  saveConversations();
  renderConversationList();
}

function switchConversation(id) {
  if (activeConvId && allConversations[activeConvId]) {
    allConversations[activeConvId].messages = conversation;
    allConversations[activeConvId].displayMessages = sanitizeHtml(messagesEl.innerHTML).replace(/src="data:image\/[^"]+"/g, 'src=""');
  }
  activeConvId = id;
  activeToolGroup = null; stepCount = 0; // Reset tool group state
  const conv = allConversations[id];
  conversation = conv?.messages || [];
  messagesEl.innerHTML = sanitizeHtml(conv?.displayMessages || '');
  migrateOldMessages(messagesEl);
  // Finalize any uncollapsed groups restored from storage
  messagesEl.querySelectorAll('.tool-group:not(.collapsed)').forEach(g => finalizeToolGroup(g));
  scrollBottom();
  saveConversations();
  renderConversationList();
}

function deleteConversation(id) {
  delete allConversations[id];
  if (activeConvId === id) {
    const ids = Object.keys(allConversations).sort((a, b) => (allConversations[b].updatedAt || 0) - (allConversations[a].updatedAt || 0));
    ids.length > 0 ? switchConversation(ids[0]) : (createConversation(), conversation = [], messagesEl.innerHTML = '');
  }
  saveConversations();
  renderConversationList();
}

function renderConversationList() {
  const listEl = document.getElementById('conversation-list');
  const sorted = Object.values(allConversations).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  listEl.innerHTML = '';
  for (const conv of sorted) {
    const div = document.createElement('div');
    div.className = 'conv-item' + (conv.id === activeConvId ? ' active' : '');
    const ago = formatTimeAgo(conv.updatedAt);
    const tabBadge = conv.tabId ? `<span class="conv-tab" title="tab ${conv.tabId}">#${String(conv.tabId).slice(-4)}</span>` : '';
    div.innerHTML = `${tabBadge}<span class="conv-title">${escapeHtml(conv.title)}</span><span class="conv-time">${ago}</span><button class="conv-delete" data-id="${conv.id}" title="Delete">&times;</button>`;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('conv-delete')) { e.stopPropagation(); deleteConversation(e.target.dataset.id); return; }
      switchConversation(conv.id);
    });
    listEl.appendChild(div);
  }
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  return Math.floor(diff / 86400000) + 'd';
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ── HTML Sanitizer (allowlist, DOM-based) ──
// Prevents XSS from AI output, tool results, or restored conversation HTML.
const _SAN_ALLOWED_TAGS = new Set([
  'A','B','BLOCKQUOTE','BR','BUTTON','CODE','DIV','EM','H1','H2','H3','H4','H5','H6',
  'HR','I','IMG','LI','OL','P','PRE','SPAN','STRONG','TABLE','TBODY','TD','TH','THEAD','TR','UL',
]);
// Attributes allowed on any tag (plus data-*)
const _SAN_GLOBAL_ATTRS = new Set(['class','title','dir','lang']);
// Per-tag extra attributes
const _SAN_TAG_ATTRS = {
  A: new Set(['href','target','rel']),
  IMG: new Set(['src','alt','width','height']),
};
function _sanIsSafeUrl(url, { allowData = false } = {}) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true;
  if (allowData && trimmed.startsWith('data:image/')) return true;
  return false;
}
function sanitizeHtml(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  const walk = (node) => {
    // NodeList is live; iterate over a snapshot
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
      const tag = child.tagName;
      if (!_SAN_ALLOWED_TAGS.has(tag)) {
        // Recurse first so unsafe descendants (e.g. <img src="javascript:...">)
        // get their attributes sanitized before we hoist them into the parent.
        walk(child);
        const parent = child.parentNode;
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      // Strip attributes not in allowlist; enforce URL safety
      const allowedForTag = _SAN_TAG_ATTRS[tag];
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const isData = name.startsWith('data-');
        const allowed = isData || _SAN_GLOBAL_ATTRS.has(name) || (allowedForTag && allowedForTag.has(name));
        if (!allowed) { child.removeAttribute(attr.name); continue; }
        if (name === 'href' && !_sanIsSafeUrl(attr.value)) { child.removeAttribute(attr.name); continue; }
        if (name === 'src') {
          const allowData = tag === 'IMG';
          if (!_sanIsSafeUrl(attr.value, { allowData })) { child.removeAttribute(attr.name); continue; }
        }
      }
      // Force safe defaults for <a>
      if (tag === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      walk(child);
    }
  };
  walk(tpl.content);
  const container = document.createElement('div');
  container.appendChild(tpl.content);
  return container.innerHTML;
}

// ── State ──

let conversation = [];
let isRunning = false;
let abortController = null;
let pendingImages = [];
let thinkingEnabled = false;
let fastMode = false;

// ── DOM ──

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const modelSelect = document.getElementById('model-select');
const fileInput = document.getElementById('file-input');
const attachmentsEl = document.getElementById('attachments');
const thinkingToggle = document.getElementById('thinking-toggle');
const fastToggle = document.getElementById('fast-toggle');
const sidebar = document.getElementById('sidebar');
const stepsSelect = document.getElementById('steps-select');

// Restore settings
const savedModel = localStorage.getItem('clawline-model');
if (savedModel && [...modelSelect.options].some(o => o.value === savedModel)) modelSelect.value = savedModel;
const savedSteps = localStorage.getItem('clawline-steps');
if (savedSteps) stepsSelect.value = savedSteps;
thinkingEnabled = localStorage.getItem('clawline-thinking') === 'true';
fastMode = localStorage.getItem('clawline-fast') === 'true';
if (thinkingEnabled) thinkingToggle.classList.add('active');
if (fastMode) fastToggle.classList.add('active');

// ── Skill Modes (declared early — referenced by restore logic below) ──

const SKILL_MODES = {
  general: {
    label: 'General',
    instructions: `- Be concise. Focus on completing the task, not explaining your process.
- Handle errors gracefully — try alternatives when one approach fails.
- For multi-field forms, use batch_form_input (with click_after for submit). Use form_input only for a single field.
- You may investigate issues using console, network, and JS tools when needed.
- Balance between completing the task efficiently and being thorough.`,
  },
  qa: {
    label: 'QA Test',
    instructions: `- You are a QA tester. Execute the user's test steps in order and report results in a structured format.

EXECUTION RULES:
- Follow numbered steps EXACTLY in order. Do NOT skip, reorder, or invent steps.
- For multi-field forms, use batch_form_input (with click_after for submit) — never fill one field at a time.
- After actions that trigger navigation or loading, pass wait_for="load" so the next step sees a settled page.
- If the submit button needs wait_for="load" to settle, omit click_after from batch_form_input and call computer left_click(ref=submit_btn, wait_for="load") as a separate step. (batch_form_input's click_after does not support wait_for.)
- Do NOT retry a failed step. Mark dependent subsequent steps as BLOCKED instead of executing them.

SCREENSHOT POLICY (efficient evidence capture):
- DO screenshot at state transitions: after login, after form submission, after navigation, and at the final result.
- DO screenshot when a step fails (tool returned error, wait_for timed out, batch reported ok:false, or page state doesn't match expectation).
- Do NOT screenshot during data entry or between intermediate clicks — trust the tool_result text.
- Target: one screenshot per logical checkpoint, not per atomic action.

INVESTIGATION:
- Use read_console_messages or read_network_requests ONLY when diagnosing a FAIL, to give the user a useful failure reason. Otherwise do not investigate.
- Never modify the page or "fix" issues you find. Report only.

REPORT FORMAT (one block per step):
Step N: <verbatim step description>
Result: PASS | FAIL | BLOCKED
Evidence: <one-line observation — what you saw, error text, status code, etc.>

End with a summary line: "X passed / Y failed / Z blocked of N steps."`,
  },
  scraper: {
    label: 'Scraper',
    instructions: `- You are a data extraction specialist. Focus on getting the requested data.
- If a page doesn't load or blocks you, try alternatives: different selectors, scroll, wait, or JavaScript extraction.
- Structure extracted data clearly using tables, lists, or JSON format.
- Handle pagination automatically — keep extracting until all pages are done.
- Skip non-essential content (ads, navigation, footers, cookie banners).
- Be resilient: if one approach fails, try another without asking the user.`,
  },
  custom: {
    label: 'Custom',
    instructions: '', // filled from localStorage
  },
};

let currentSkillMode = 'general';

// Restore API settings
const savedApiUrl = localStorage.getItem('clawline-api-url');
if (savedApiUrl) API_URL = savedApiUrl;
// API_KEY is kept in chrome.storage.session (memory-only, cleared when the
// browser closes). A one-time migration moves any legacy plaintext value out
// of localStorage so we don't leave secrets at rest on disk.
(async () => {
  try {
    const legacy = localStorage.getItem('clawline-api-key');
    if (legacy) {
      await chrome.storage.session.set({ 'clawline-api-key': legacy });
      localStorage.removeItem('clawline-api-key');
      API_KEY = legacy;
    } else {
      const res = await chrome.storage.session.get('clawline-api-key');
      if (res['clawline-api-key']) API_KEY = res['clawline-api-key'];
    }
  } catch (e) { console.warn('[clawline] api key load failed:', e); }
})();

// Restore skill mode
const modeSelect = document.getElementById('mode-select');
const savedMode = localStorage.getItem('clawline-mode');
if (savedMode && SKILL_MODES[savedMode]) {
  currentSkillMode = savedMode;
  modeSelect.value = savedMode;
}
const savedCustomInstructions = localStorage.getItem('clawline-custom-instructions');
if (savedCustomInstructions) SKILL_MODES.custom.instructions = savedCustomInstructions;

// Settings panel
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const bridgePanel = document.getElementById('bridge-panel');
const cfgApiUrl = document.getElementById('cfg-api-url');
const cfgApiKey = document.getElementById('cfg-api-key');

// Bridge panel toggle
document.getElementById('hook-status').addEventListener('click', () => {
  const visible = bridgePanel.style.display !== 'none';
  bridgePanel.style.display = visible ? 'none' : 'block';
  if (!visible) {
    settingsPanel.style.display = 'none'; // close settings if open
    renderBridgePanel();
    checkApiHealth();
  }
});

// API health check
async function checkApiHealth() {
  const apiVal = document.getElementById('bp-api-val');
  if (!apiVal) return;
  const apiHost = API_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  apiVal.textContent = apiHost + ' ...';
  apiVal.className = 'bp-val bp-off';
  try {
    await fetch(API_URL.replace(/\/+$/, '') + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
    // Any response (even 400/401) means the endpoint is reachable
    apiVal.textContent = apiHost;
    apiVal.className = 'bp-val bp-on';
  } catch {
    apiVal.textContent = apiHost + ' (unreachable)';
    apiVal.className = 'bp-val bp-off';
  }
}

settingsBtn.addEventListener('click', () => {
  const visible = settingsPanel.style.display !== 'none';
  settingsPanel.style.display = visible ? 'none' : 'block';
  if (!visible) {
    bridgePanel.style.display = 'none'; // close bridge panel if open
    cfgApiUrl.value = API_URL;
    cfgApiKey.value = API_KEY;
  }
});

document.getElementById('cfg-save').addEventListener('click', async () => {
  API_URL = cfgApiUrl.value.trim() || 'http://127.0.0.1:4819';
  API_KEY = cfgApiKey.value.trim();
  localStorage.setItem('clawline-api-url', API_URL);
  try { await chrome.storage.session.set({ 'clawline-api-key': API_KEY }); } catch (e) { console.warn('[clawline] api key save failed:', e); }
  settingsPanel.style.display = 'none';
  setStatus('Settings saved'); setTimeout(() => setStatus(''), 1500);
});

document.getElementById('cfg-cancel').addEventListener('click', () => {
  settingsPanel.style.display = 'none';
});

// Export history
document.getElementById('cfg-export').addEventListener('click', () => {
  const data = { conversations: allConversations, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clawline-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('History exported'); setTimeout(() => setStatus(''), 1500);
});

// Import history
document.getElementById('cfg-import-btn').addEventListener('click', () => {
  document.getElementById('cfg-import-file').click();
});
document.getElementById('cfg-import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const convs = data.conversations;
    if (!convs || typeof convs !== 'object') throw new Error('Invalid format');
    let count = 0;
    for (const [id, conv] of Object.entries(convs)) {
      if (!allConversations[id]) {
        allConversations[id] = conv;
        count++;
      }
    }
    saveConversations();
    renderConversationList();
    setStatus(`Imported ${count} conversations`); setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    setStatus(`Import failed: ${err.message}`); setTimeout(() => setStatus(''), 3000);
  }
  e.target.value = '';
});

modelSelect.addEventListener('change', () => localStorage.setItem('clawline-model', modelSelect.value));
stepsSelect.addEventListener('change', () => localStorage.setItem('clawline-steps', stepsSelect.value));

// Skill mode selector
const customModeEditor = document.getElementById('custom-mode-editor');
const customModeText = document.getElementById('custom-mode-text');

modeSelect.addEventListener('change', () => {
  currentSkillMode = modeSelect.value;
  localStorage.setItem('clawline-mode', currentSkillMode);
  if (currentSkillMode === 'custom') {
    customModeText.value = SKILL_MODES.custom.instructions;
    customModeEditor.style.display = 'block';
  } else {
    customModeEditor.style.display = 'none';
  }
  setStatus(`Mode: ${SKILL_MODES[currentSkillMode]?.label || currentSkillMode}`);
  setTimeout(() => setStatus(''), 1500);
});

document.getElementById('custom-mode-save').addEventListener('click', () => {
  SKILL_MODES.custom.instructions = customModeText.value.trim();
  localStorage.setItem('clawline-custom-instructions', SKILL_MODES.custom.instructions);
  customModeEditor.style.display = 'none';
  setStatus('Custom mode saved'); setTimeout(() => setStatus(''), 1500);
});

document.getElementById('custom-mode-cancel').addEventListener('click', () => {
  customModeEditor.style.display = 'none';
});

function getMaxLoops() { return parseInt(stepsSelect.value) || 50; }
thinkingToggle.addEventListener('click', () => {
  thinkingEnabled = !thinkingEnabled;
  thinkingToggle.classList.toggle('active', thinkingEnabled);
  localStorage.setItem('clawline-thinking', thinkingEnabled);
  if (thinkingEnabled && fastMode) { fastMode = false; fastToggle.classList.remove('active'); localStorage.setItem('clawline-fast', false); }
  setStatus(thinkingEnabled ? 'Extended thinking ON' : 'Extended thinking OFF');
  setTimeout(() => setStatus(''), 1500);
});
fastToggle.addEventListener('click', () => {
  fastMode = !fastMode;
  fastToggle.classList.toggle('active', fastMode);
  localStorage.setItem('clawline-fast', fastMode);
  if (fastMode && thinkingEnabled) { thinkingEnabled = false; thinkingToggle.classList.remove('active'); localStorage.setItem('clawline-thinking', false); }
  setStatus(fastMode ? `Fast mode ON (${FAST_MODEL})` : 'Fast mode OFF');
  setTimeout(() => setStatus(''), 1500);
});
document.getElementById('history-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
document.getElementById('sidebar-close').addEventListener('click', () => sidebar.classList.remove('open'));
document.getElementById('sidebar-backdrop').addEventListener('click', () => sidebar.classList.remove('open'));

function getModel() { return fastMode ? FAST_MODEL : modelSelect.value; }

// ── Tool Definitions (matches original extension) ──

const TOOLS = [
  { name: 'read_page', description: 'Get accessibility tree of page elements with ref_IDs. Use filter="interactive" for only buttons/links/inputs. Use ref_id to focus on a specific element subtree.', input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['interactive', 'all'], description: 'Filter: "interactive" for buttons/links/inputs only, "all" for all elements (default)' }, depth: { type: 'number', description: 'Max tree depth (default: 15)' }, ref_id: { type: 'string', description: 'Focus on a specific element by ref_ID' }, max_chars: { type: 'number', description: 'Max output chars (default: 15000)' } } } },
  { name: 'find', description: 'Find elements by natural language query. Returns up to 20 matching elements with ref_IDs. E.g. "search bar", "login button", "product title containing organic".', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Natural language description of what to find' } }, required: ['query'] } },
  { name: 'form_input', description: 'Set a single form element value by ref_ID. For checkboxes use boolean, for selects use option value/text, for inputs use string. Prefer batch_form_input when setting multiple fields.', input_schema: { type: 'object', properties: { ref: { type: 'string', description: 'Element ref_ID from read_page (e.g. "ref_1")' }, value: { type: ['string', 'boolean', 'number'], description: 'Value to set' } }, required: ['ref', 'value'] } },
  { name: 'batch_form_input', description: 'Set multiple form fields at once in a single call. Much faster than calling form_input repeatedly. Use this whenever you need to fill 2+ fields. You may take ONE screenshot after all fields are set to verify the overall result.', input_schema: { type: 'object', properties: { fields: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string', description: 'Element ref_ID' }, value: { type: ['string', 'boolean', 'number'], description: 'Value to set' } }, required: ['ref', 'value'] }, description: 'Array of {ref, value} pairs to set' }, click_after: { type: 'string', description: 'Optional ref_ID to click after all fields are set (e.g. submit button)' } }, required: ['fields'] } },
  { name: 'computer', description: 'Mouse, keyboard, and screenshot actions. Always take a screenshot first to see coordinates before clicking. Click element centers, not edges. After click, optionally pass wait_for=load|selector|none to settle before next step (QA-critical).', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['left_click', 'right_click', 'type', 'screenshot', 'wait', 'scroll', 'key', 'left_click_drag', 'double_click', 'triple_click', 'zoom', 'scroll_to', 'hover'], description: 'Action to perform. zoom: capture a specific region for closer inspection. scroll_to: scroll element into view by ref.' }, coordinate: { type: 'array', items: { type: 'number' }, description: '[x, y] pixel coordinates. For drag, this is the end position.' }, text: { type: 'string', description: 'Text to type (for type action) or keys to press (for key action, e.g. "cmd+a", "Backspace")' }, duration: { type: 'number', description: 'Seconds to wait (for wait action, max 10)' }, scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' }, scroll_amount: { type: 'number', description: 'Scroll ticks (default 3)' }, start_coordinate: { type: 'array', items: { type: 'number' }, description: 'Start [x,y] for drag' }, region: { type: 'array', items: { type: 'number' }, description: '[x0, y0, x1, y1] rectangle to capture for zoom action' }, repeat: { type: 'number', description: 'Times to repeat key sequence (for key action, default 1)' }, ref: { type: 'string', description: 'Element ref_ID — alternative to coordinate for click/scroll_to' }, modifiers: { type: 'string', description: 'Modifier keys: "ctrl", "shift", "alt", "cmd". Combine with "+" (e.g. "ctrl+shift")' }, wait_for: { type: 'string', enum: ['load', 'selector', 'none'], description: 'After click: wait for page to settle. "load"=tabs.onUpdated complete; "selector"=requires wait_for_selector; "none"=skip.' }, wait_for_selector: { type: 'string', description: 'CSS selector to wait for when wait_for="selector"' }, wait_timeout: { type: 'number', description: 'Wait timeout in seconds (default 8, max 30)' } }, required: ['action'] } },
  { name: 'navigate', description: 'Navigate to a URL, or use "back"/"forward" for browser history. Defaults to wait_for=load (tab status complete).', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to (http/https only), or "back"/"forward" for history' }, wait_for: { type: 'string', enum: ['load', 'selector', 'none'], description: 'Settle condition (default "load")' }, wait_for_selector: { type: 'string', description: 'CSS selector for wait_for="selector"' }, wait_timeout: { type: 'number', description: 'Wait timeout in seconds (default 10, max 30)' } }, required: ['url'] } },
  { name: 'get_page_text', description: 'Extract raw text content from the page. Ideal for reading articles, blog posts, or text-heavy pages. Returns plain text without HTML.', input_schema: { type: 'object', properties: { max_chars: { type: 'number', description: 'Max chars (default: 15000)' } } } },
  { name: 'tabs_create', description: 'Create a new empty browser tab.', input_schema: { type: 'object', properties: {} } },
  { name: 'tabs_context', description: 'Get list of all open browser tabs with their IDs, titles, and URLs.', input_schema: { type: 'object', properties: {} } },
  { name: 'read_console_messages', description: 'Read browser console messages (console.log/error/warn). Use pattern to filter. Useful for debugging.', input_schema: { type: 'object', properties: { onlyErrors: { type: 'boolean', description: 'Only return errors (default: false)' }, pattern: { type: 'string', description: 'Regex pattern to filter messages' }, limit: { type: 'number', description: 'Max messages (default: 100)' }, clear: { type: 'boolean', description: 'Clear after reading (default: false)' } } } },
  { name: 'read_network_requests', description: 'Read HTTP network requests (XHR, Fetch, etc). Useful for debugging API calls.', input_schema: { type: 'object', properties: { urlPattern: { type: 'string', description: 'URL pattern to filter (e.g. "/api/")' }, limit: { type: 'number', description: 'Max requests (default: 100)' }, clear: { type: 'boolean', description: 'Clear after reading (default: false)' } } } },
  { name: 'resize_window', description: 'Resize browser window to specific dimensions. Useful for responsive testing.', input_schema: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] } },
  { name: 'emulate_device', description: 'Emulate a mobile device or reset to desktop. Sets viewport size, device pixel ratio, user agent, and touch support via CDP. Use preset names or custom values.', input_schema: { type: 'object', properties: { preset: { type: 'string', enum: ['iPhone 14', 'iPhone 14 Pro Max', 'iPhone SE', 'iPad', 'iPad Pro', 'Pixel 7', 'Galaxy S23', 'desktop'], description: 'Device preset name, or "desktop" to reset' }, width: { type: 'number', description: 'Custom viewport width (overrides preset)' }, height: { type: 'number', description: 'Custom viewport height (overrides preset)' }, deviceScaleFactor: { type: 'number', description: 'Device pixel ratio (default from preset)' }, mobile: { type: 'boolean', description: 'Enable mobile mode (default from preset)' } } } },
  { name: 'javascript_tool', description: 'Execute JavaScript in the page context. Returns result of last expression. Do NOT use "return" — just write the expression.', input_schema: { type: 'object', properties: { action: { type: 'string', description: 'Must be "javascript_exec"' }, text: { type: 'string', description: 'JavaScript code to execute' } }, required: ['action', 'text'] } },
  { name: 'file_upload', description: 'Upload files to a file input element. Do NOT click file inputs — use this tool with the ref_ID instead. Paths must be absolute.', input_schema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to upload' }, ref: { type: 'string', description: 'ref_ID of the file input element' } }, required: ['paths', 'ref'] } },
  { name: 'update_plan', description: 'Present a plan to the user before proceeding with complex tasks.', input_schema: { type: 'object', properties: { domains: { type: 'array', items: { type: 'string' }, description: 'Domains to visit' }, approach: { type: 'array', items: { type: 'string' }, description: 'Ordered steps (3-7)' } }, required: ['domains', 'approach'] } },
  { name: 'turn_answer_start', description: 'Call this immediately before your text response to the user for this turn. Required every turn - whether or not you made tool calls. After calling, write your response. No more tools after this.', input_schema: { type: 'object', properties: {}, required: [] }, cache_control: { type: 'ephemeral' } },
];

// ── System Prompt ──

function buildSystemPrompt() {
  const mode = SKILL_MODES[currentSkillMode] || SKILL_MODES.general;
  const behaviorText = mode.instructions || SKILL_MODES.general.instructions;

  return [
  { type: 'text', text: `You are a web automation assistant running as a Chrome browser extension. You can ONLY interact with web pages through the browser tools provided below. You are NOT a terminal, shell, or OS-level agent.

<capabilities>
You CAN:
- View and interact with web pages (screenshot, click, type, scroll, navigate)
- Read page content (DOM tree, text extraction, accessibility tree)
- Fill forms, select options, upload files
- Execute JavaScript within page context
- Open/manage browser tabs
- Read browser console logs and network requests

You CANNOT:
- Run shell commands, terminal operations, or OS-level tasks
- Access the filesystem, install software, or modify system settings
- Run Python, Node.js, or any server-side code
- Access databases, APIs, or services outside the browser
- Interact with desktop applications

If the user asks for something outside browser capabilities, clearly explain that you are a browser automation tool and suggest they use a different tool for OS-level operations.
</capabilities>

<user_privacy>
- Never enter sensitive financial or identity information (bank accounts, SSN, passwords, credit cards)
- Never create accounts on the user's behalf
- Never authorize password-based access — direct the user to input passwords themselves
- Choose privacy-preserving options for cookie banners and permission popups
- Never bypass CAPTCHA or bot detection systems
</user_privacy>

<tool_usage_requirements>
CRITICAL RULES for efficient browser automation:

1. ALWAYS use read_page first to get element ref_IDs before taking any action. This assigns references (ref_1, ref_2...) to DOM elements so you can interact with them reliably.

2. PREFER ref-based actions over coordinate-based actions:
   - Use computer left_click with "ref" parameter, or form_input with "ref" parameter
   - Only fall back to coordinate-based clicking when ref actions fail

3. NEVER repeatedly scroll to read long pages. Instead use get_page_text to read article content, or read_page with filter="interactive" to get only interactive elements.

4. For complex web apps (Google Docs, Figma, Canva) where read_page returns no meaningful content, use screenshots instead.

5. Use batch_form_input to set multiple form fields at once — it's much faster than calling form_input one by one. Only use form_input for a single field. After batch filling, you may take ONE screenshot to verify the overall result — but do NOT screenshot after each individual field.

6. After completing tool calls, provide a brief summary to the user. Don't repeat information already visible.

7. Don't keep taking screenshots to verify simple actions. Trust the tool results.

8. When a task is done, stop. Don't add unnecessary verification steps.
</tool_usage_requirements>

<efficiency_rules>
- Take action immediately. Don't explain what you're going to do before doing it.
- Combine related observations into one response, not multiple steps.
- If read_page shows what you need, act on it directly. Don't screenshot to "verify" what you already know.
- MINIMIZE wait calls. Only use wait when explicitly waiting for async operations (page load, AI response). After clicking/filling, take action immediately — do NOT wait first.
- Never do wait→screenshot→wait→screenshot loops.
- After clicking/typing, trust the tool result. Only screenshot if you need to see VISUAL changes.
</efficiency_rules>

<output_formatting>
- Do NOT use emoji characters (🔴✅❌🟢 etc.) in your responses. Use plain text symbols instead: ✓ for success/pass, ✗ for failure/fail, • for bullet points, → for arrows.
- Keep your responses clean and professional.
</output_formatting>

<behavior_instructions>
The current date is ${new Date().toLocaleDateString()}.
Current mode: ${mode.label}.

${behaviorText}
</behavior_instructions>

<tool_workflows>
1. See page structure: read_page (filter="interactive" first, "all" only if needed)
2. Find specific elements: find("search button") → get ref_IDs
3. Click elements: computer left_click with ref="ref_1" (preferred) or coordinate=[x,y]
4. Fill forms: batch_form_input with fields=[{ref, value}, ...] and optional click_after for submit
5. Navigate: navigate with url, or "back"/"forward"
6. Read content: get_page_text for articles, read_page for structure
7. Debug: read_console_messages, read_network_requests, javascript_tool
8. Screenshot: only when visual layout matters and read_page can't tell you what you need
</tool_workflows>` },
  { type: 'text', text: `Platform: ${navigator.platform.includes('Mac') ? 'Mac — use "cmd" as modifier key (cmd+a, cmd+c, cmd+v)' : 'Windows/Linux — use "ctrl" as modifier key (ctrl+a, ctrl+c, ctrl+v)'}` },
  { type: 'text', text: `<turn_answer_start_instructions>
Before outputting any text response to the user this turn, call turn_answer_start first.

WITH TOOL CALLS: After completing all tool calls, call turn_answer_start, then write your response.
WITHOUT TOOL CALLS: Call turn_answer_start immediately, then write your response.

RULES:
- Call exactly once per turn
- Call immediately before your text response
- NEVER call during intermediate thoughts, reasoning, or while planning to use more tools
- No more tools after calling this
</turn_answer_start_instructions>`, cache_control: { type: 'ephemeral' } },
  ];
}

// ── UI Helpers ──

inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'; });
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
sendBtn.addEventListener('click', sendMessage);
stopBtn.addEventListener('click', stopAgent);
document.getElementById('new-chat').addEventListener('click', () => {
  if (activeConvId && conversation.length > 0) saveCurrentState();
  createConversation();
  conversation = [];
  messagesEl.innerHTML = '';
  pendingImages = [];
  attachmentsEl.innerHTML = '';
  lockedTabId = null; // Reset tab lock for new conversation
  renderConversationList();
});

fileInput.addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    if (!file.type.startsWith('image/')) continue;
    const base64 = await fileToBase64(file);
    pendingImages.push({ base64, mediaType: file.type });
    renderAttachments();
  }
  fileInput.value = '';
});

function fileToBase64(file) {
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(file); });
}

function renderAttachments() {
  attachmentsEl.innerHTML = '';
  pendingImages.forEach((img, i) => {
    const div = document.createElement('div');
    div.className = 'attachment-preview';
    div.innerHTML = `<img src="data:${img.mediaType};base64,${img.base64}"><button class="attachment-remove" data-idx="${i}">&times;</button>`;
    div.querySelector('button').onclick = () => { pendingImages.splice(i, 1); renderAttachments(); };
    attachmentsEl.appendChild(div);
  });
}

function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
function setStatus(t) { statusEl.textContent = t; }
function setRunning(r) { isRunning = r; sendBtn.disabled = r; stopBtn.style.display = r ? 'flex' : 'none'; inputEl.disabled = r; }
function stopAgent() { abortController?.abort(); abortController = null; setRunning(false); setStatus('Stopped'); setTimeout(() => setStatus(''), 1500); }

// ── Markdown Renderer ──

function renderMarkdown(text) {
  // Extract code blocks first to protect them
  const codeBlocks = [];
  let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre><code>${code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code></pre>`);
    return `\n%%CODE_BLOCK_${codeBlocks.length - 1}%%\n`;
  });

  // Escape HTML in remaining text
  processed = processed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Tables: detect | col | col | patterns
  processed = processed.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    const rows = tableBlock.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return tableBlock;
    const parseRow = r => r.split('|').slice(1, -1).map(c => c.trim());
    const headerCells = parseRow(rows[0]);
    const isSep = rows[1] && /^\|[\s\-:|]+\|$/.test(rows[1].trim());
    const dataStart = isSep ? 2 : 1;
    let html = '<table><thead><tr>' + headerCells.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
    for (let i = dataStart; i < rows.length; i++) {
      const cells = parseRow(rows[i]);
      html += '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    }
    return html + '</tbody></table>';
  });

  // Inline formatting
  processed = processed
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      const safe = /^https?:\/\//i.test(url) ? url : '#';
      return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

  // Convert list items — mark source type for correct wrapping
  processed = processed.replace(/^- (.+)$/gm, '<li data-ul>$1</li>');
  processed = processed.replace(/^\d+\. (.+)$/gm, '<li data-ol>$1</li>');

  // Wrap consecutive <li> into <ul> or <ol> based on first item type
  processed = processed.replace(/((?:<li data-(?:ul|ol)>.*?<\/li>\s*)+)/g, (match) => {
    const isOrdered = match.trimStart().startsWith('<li data-ol>');
    const tag = isOrdered ? 'ol' : 'ul';
    const cleaned = match.replace(/\s*(<li) data-(?:ul|ol)>/g, '$1>').replace(/(<\/li>)\s*/g, '$1');
    return `<${tag}>${cleaned}</${tag}>`;
  });

  // Split into paragraphs by double newline
  const blocks = processed.split(/\n{2,}/);
  const result = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    // Don't wrap block-level elements in <p>
    if (/^<(h[1-6]|ul|ol|pre|table|blockquote|hr|div)[\s>]/i.test(block)) return block;
    if (/^%%CODE_BLOCK_\d+%%$/.test(block)) return block;
    // Wrap inline content in <p>, convert single newlines to <br>
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  // Restore code blocks
  let final = result;
  codeBlocks.forEach((block, i) => { final = final.replace(`%%CODE_BLOCK_${i}%%`, block); });

  // Clean up: remove <br> right before/after block elements
  final = final.replace(/<br>\s*(<\/(ul|ol|table|blockquote|pre|h[1-6])>)/g, '$1');
  final = final.replace(/(<(ul|ol|table|blockquote|pre|h[1-6]|hr)[^>]*>)\s*<br>/g, '$1');
  final = final.replace(/<p>\s*<\/p>/g, '');

  // Security: sanitize via DOM allowlist (defense-in-depth over regex-only filtering)
  return sanitizeHtml(final);
}

// ── Message Display ──

function _msgTime() {
  const now = new Date();
  return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function _msgHeader(role) {
  const header = document.createElement('div');
  header.className = 'msg-header';
  const sender = document.createElement('span');
  sender.className = 'msg-sender';
  sender.textContent = role === 'user' ? 'You' : role === 'ai' ? 'AI' : 'System';
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = _msgTime();
  header.appendChild(sender);
  header.appendChild(time);
  return header;
}

function addMsg(role, content, cls) {
  const div = document.createElement('div');
  div.className = `msg ${cls || role}`;
  div.appendChild(_msgHeader(role));
  if (role === 'ai' && typeof content === 'string') {
    const body = document.createElement('div');
    body.innerHTML = renderMarkdown(content);
    div.appendChild(body);
    const btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = '📋';
    btn.onclick = () => { navigator.clipboard.writeText(content); btn.textContent = '✓'; setTimeout(() => btn.textContent = '📋', 1000); };
    div.appendChild(btn);
  } else if (typeof content === 'string') { const span = document.createElement('span'); span.textContent = content; div.appendChild(span); }
  else { div.appendChild(content); }
  messagesEl.appendChild(div); scrollBottom(); return div;
}

function addThinking(text) { const div = document.createElement('div'); div.className = 'msg thinking'; div.appendChild(_msgHeader('ai')); const span = document.createElement('span'); span.textContent = text; div.appendChild(span); messagesEl.appendChild(div); scrollBottom(); return div; }

function addScreenshot(base64, mediaType) {
  // If inside a tool group, add as inline thumbnail on the last step
  if (activeToolGroup) {
    const body = activeToolGroup.querySelector('.tool-group-body');
    const lastStep = body?.querySelector('.tool-step:last-child');
    if (lastStep) {
      const img = document.createElement('img');
      img.src = `data:${mediaType || 'image/jpeg'};base64,${base64}`;
      img.className = 'tool-step-thumb';
      img.onclick = (e) => { e.stopPropagation(); img.classList.toggle('expanded'); };
      lastStep.appendChild(img);
      scrollBottom();
      return img;
    }
  }
  // Fallback: standalone
  const container = document.createElement('div');
  const img = document.createElement('img');
  img.src = `data:${mediaType || 'image/jpeg'};base64,${base64}`;
  img.className = 'screenshot';
  img.onclick = () => img.classList.toggle('expanded');
  container.appendChild(img);
  return addMsg('tool', container, 'tool');
}

// Tool group — step-based layout (matches original extension UI)
let activeToolGroup = null;
let stepCount = 0;

// Delegated click handler — works for both live and restored groups
messagesEl.addEventListener('click', (e) => {
  const header = e.target.closest('.tool-group-header');
  if (!header) return;
  const group = header.closest('.tool-group');
  if (!group) return;
  group.classList.toggle('collapsed');
  const arrow = group.querySelector('.tool-group-arrow');
  if (arrow) arrow.textContent = group.classList.contains('collapsed') ? '\u203A' : '\u2304';
});

function ensureToolGroup() {
  const last = messagesEl.lastElementChild;
  if (last?.classList.contains('tool-group')) { activeToolGroup = last; return activeToolGroup; }
  const group = document.createElement('div');
  group.className = 'tool-group';
  stepCount = 0;
  const header = document.createElement('div');
  header.className = 'tool-group-header';
  header.innerHTML = '<span class="tool-group-count">0 steps</span> <span class="tool-group-arrow">\u203A</span>';
  const body = document.createElement('div'); body.className = 'tool-group-body';
  group.appendChild(header); group.appendChild(body);
  messagesEl.appendChild(group); activeToolGroup = group; scrollBottom(); return group;
}

function addToolCall(name, args) {
  const group = ensureToolGroup();
  const body = group.querySelector('.tool-group-body');
  stepCount++;
  const row = document.createElement('div'); row.className = 'tool-step';
  const action = args?.action;
  let label;
  if (name === 'computer') {
    const labels = { screenshot: 'Take screenshot', left_click: 'Click', right_click: 'Right click', double_click: 'Double click', triple_click: 'Triple click', type: 'Type', key: 'Key press', scroll: 'Scroll', hover: 'Hover', wait: `Wait ${args?.duration || 2}s`, left_click_drag: 'Drag' };
    label = labels[action] || action || 'Computer';
  } else {
    const labels = { read_page: `Read page${args?.filter === 'interactive' ? ' (interactive)' : ''}`, find: `Find "${(args?.query || '').slice(0, 25)}"`, form_input: `Set ${args?.ref}`, batch_form_input: `Batch set ${args?.fields?.length || 0} fields`, navigate: 'Navigate', get_page_text: 'Get page text', javascript_tool: 'JavaScript', tabs_create: 'Create tab', tabs_context: 'Tab context', read_console_messages: 'Console', read_network_requests: 'Network', resize_window: 'Resize', emulate_device: `Emulate ${args?.preset || 'device'}`, file_upload: 'Upload file', update_plan: 'Update plan' };
    label = labels[name] || name.replace(/_/g, ' ');
  }
  row.innerHTML = `<span class="tool-step-label">${escapeHtml(label)}</span>`;
  body.appendChild(row);
  group.querySelector('.tool-group-count').textContent = `${stepCount} steps`;
  scrollBottom();
  return row;
}

function addToolResult(text) {
  if (!activeToolGroup || !text) return;
  const body = activeToolGroup.querySelector('.tool-group-body');
  const lastStep = body?.querySelector('.tool-step:last-child');
  if (!lastStep) return;

  if (text.length <= 200) {
    // Short result: show inline on the step row
    const detail = document.createElement('span');
    detail.className = 'tool-step-detail';
    detail.textContent = text;
    lastStep.appendChild(detail);
  } else {
    // Long result: show in collapsible block below the step
    const detail = document.createElement('div');
    detail.className = 'tool-step-detail-block collapsed';
    const preview = text.slice(0, 150) + '...';
    detail.textContent = preview;
    detail.title = 'Click to expand';
    detail.onclick = (e) => {
      e.stopPropagation();
      const isCollapsed = detail.classList.toggle('collapsed');
      detail.textContent = isCollapsed ? preview : text;
    };
    lastStep.appendChild(detail);
  }
  scrollBottom();
}

function endToolGroup() {
  // Only reset reference — don't collapse (latest group stays expanded)
  activeToolGroup = null; stepCount = 0;
}

// Extract last text step from a group → standalone AI message, then collapse group
function finalizeToolGroup(group) {
  if (!group) return;
  const body = group.querySelector('.tool-group-body');
  if (!body) return;
  const textSteps = body.querySelectorAll('.tool-step-text');
  const lastText = textSteps.length > 0 ? textSteps[textSteps.length - 1] : null;
  if (lastText) {
    const content = lastText.querySelector('.tool-step-text-content');
    if (content?.innerHTML?.trim()) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'msg ai';
      msgDiv.innerHTML = content.innerHTML;
      lastText.remove();
      // Update step count
      const remaining = body.querySelectorAll('.tool-step').length;
      const countEl = group.querySelector('.tool-group-count');
      if (countEl) countEl.textContent = `${remaining} steps`;
      if (remaining === 0) { group.replaceWith(msgDiv); return; }
      // Collapse group and insert message after it
      group.classList.add('collapsed');
      const arrow = group.querySelector('.tool-group-arrow');
      if (arrow) arrow.textContent = '\u203A';
      group.after(msgDiv);
    }
  }
  // Collapse even if no text to extract
  if (!group.classList.contains('collapsed')) {
    group.classList.add('collapsed');
    const arrow = group.querySelector('.tool-group-arrow');
    if (arrow) arrow.textContent = '\u203A';
  }
}

function addTextStep() {
  const group = ensureToolGroup();
  const body = group.querySelector('.tool-group-body');
  stepCount++;
  const row = document.createElement('div');
  row.className = 'tool-step tool-step-text';
  const bullet = document.createElement('span');
  bullet.className = 'tool-step-bullet';
  bullet.textContent = '\u2022';
  const content = document.createElement('div');
  content.className = 'tool-step-text-content';
  row.appendChild(bullet);
  row.appendChild(content);
  body.appendChild(row);
  group.querySelector('.tool-group-count').textContent = `${stepCount} steps`;
  scrollBottom();
  return content;
}

// ── Screenshot Optimization ──

const SS_PX_PER_TOKEN = 28, SS_MAX_PX = 1568, SS_MAX_TOKENS = 1568;
const SS_INIT_QUALITY = 75, SS_MIN_QUALITY = 10, SS_QUALITY_STEP = 5, SS_MAX_B64 = 1398100;

function calcSSDimensions(w, h) {
  const pxT = (sw, sh) => Math.ceil(sw / SS_PX_PER_TOKEN) * Math.ceil(sh / SS_PX_PER_TOKEN);
  if (w <= SS_MAX_PX && h <= SS_MAX_PX && pxT(w, h) <= SS_MAX_TOKENS) return [w, h];
  const swapped = h > w; if (swapped) [w, h] = [h, w];
  const ratio = w / h; let lo = 1, hi = w;
  while (lo + 1 < hi) { const mid = Math.floor((lo + hi) / 2); const sh = Math.max(Math.round(mid / ratio), 1); mid <= SS_MAX_PX && pxT(mid, sh) <= SS_MAX_TOKENS ? lo = mid : hi = mid; }
  const rh = Math.max(Math.round(lo / ratio), 1); return swapped ? [rh, lo] : [lo, rh];
}

let lastViewport = { vw: 0, vh: 0, sw: 0, sh: 0 };

function scaleCoordinate(x, y) {
  if (lastViewport.sw && lastViewport.vw && lastViewport.sw !== lastViewport.vw) {
    return [Math.round(x * lastViewport.vw / lastViewport.sw), Math.round(y * lastViewport.vh / lastViewport.sh)];
  }
  return [x, y];
}

// ── Persistent Debugger ──

let debuggerTabId = null;
let _debuggerEventListener = null;
let _ensureDebuggerLock = null;

// Auto-clear debuggerTabId when browser detaches debugger (e.g. user opens DevTools)
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === debuggerTabId) debuggerTabId = null;
});

// If the tab or window hosting the debugger target goes away, drop our reference
// so we don't try to send CDP commands to a dead tab (silent-hang, stale banner).
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === debuggerTabId) debuggerTabId = null;
  if (tabId === lockedTabId) lockedTabId = null;
});
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === currentWindowId) currentWindowId = null;
});

// Auto-switch sidepanel to the conversation associated with the active tab.
// When user clicks a different tab in this window, find the most recent
// conversation that ran on that tab and surface it. Best-effort: skipped if
// agent is mid-task or no matching conversation exists.
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    if (windowId !== currentWindowId) return;
    if (isRunning) return; // don't yank UI while a task is running
    if (allConversations[activeConvId]?.tabId === tabId) return; // already on it
    // Find most recent conversation for this tab
    const candidates = Object.values(allConversations)
      .filter(c => c.tabId === tabId)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (candidates.length === 0) return;
    if (candidates[0].id === activeConvId) return;
    switchConversation(candidates[0].id);
  } catch (e) {
    console.warn('[clawline] tab-activated auto-switch failed:', e.message);
  }
});
// Detach debugger when the sidepanel unloads (closed, reloaded) — otherwise the
// "Clawline started debugging this browser" banner lingers until Chrome exits.
window.addEventListener('pagehide', () => { try { if (debuggerTabId) chrome.debugger.detach({ tabId: debuggerTabId }); } catch {} });

async function ensureDebugger(tabId) {
  // Mutex: serialize concurrent calls
  while (_ensureDebuggerLock) await _ensureDebuggerLock;
  let unlock;
  _ensureDebuggerLock = new Promise(r => { unlock = r; });
  try {
    await _ensureDebuggerInner(tabId);
  } finally {
    _ensureDebuggerLock = null;
    unlock();
  }
}

async function _ensureDebuggerInner(tabId) {
  if (debuggerTabId === tabId) return;
  if (debuggerTabId) { try { await chrome.debugger.detach({ tabId: debuggerTabId }); } catch {} debuggerTabId = null; }
  // Remove previous debugger event listener to prevent leaks
  if (_debuggerEventListener) {
    chrome.debugger.onEvent.removeListener(_debuggerEventListener);
    _debuggerEventListener = null;
  }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerTabId = tabId;
    window.__clawlineNetworkEnabled = false; // Force re-enable Network on new tab
    window.__clawlineNetworkRequests = new Map(); // Clear stale data from previous tab
  } catch (e) {
    debuggerTabId = null;
    throw new Error(`Cannot attach debugger to tab ${tabId}: ${e.message}`);
  }
}

async function releaseDebugger() {
  if (debuggerTabId) { try { await chrome.debugger.detach({ tabId: debuggerTabId }); } catch {} debuggerTabId = null; }
}

async function cdp(method, params) {
  if (!debuggerTabId) throw new Error('Debugger not attached');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
    chrome.debugger.sendCommand({ tabId: debuggerTabId }, method, params)
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

// ── Wait / settle helpers (QA reliability) ──
// All helpers return a short string reason ('load'|'idle'|'found'|'timeout'|...)
// and never throw — callers should treat 'timeout' as a soft signal, not an error.

function _waitForLoadComplete(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reason) => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(listener); clearTimeout(t); resolve(reason); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish('load'); };
    const t = setTimeout(() => finish('timeout'), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    // Already complete? Resolve immediately.
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish('already-complete'); }).catch(() => {});
  });
}

async function _waitForSelector(tabId, selector, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (abortController?.signal.aborted) return 'aborted';
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId }, func: (s) => !!document.querySelector(s), args: [selector] });
      if (r?.[0]?.result) return 'found';
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  return 'timeout';
}

async function waitForSettle(tabId, opts = {}) {
  const { condition = 'load', selector, timeout = 8000 } = opts;
  if (condition === 'none') return 'skipped';
  if (condition === 'selector') {
    if (!selector) return 'no-selector';
    return _waitForSelector(tabId, selector, timeout);
  }
  return _waitForLoadComplete(tabId, timeout);
}

// Optional post-action settle: only runs if the tool call set `wait_for`.
// Returns a short string suffix to append to the result text, or '' if no wait.
async function postActionWait(tabId, args) {
  if (!args?.wait_for) return '';
  const timeout = Math.min(args.wait_timeout || 8, 30) * 1000;
  const reason = await waitForSettle(tabId, { condition: args.wait_for, selector: args.wait_for_selector, timeout });
  return ` [wait_for=${args.wait_for}:${reason}]`;
}

// ── Tool Execution ──

// Lock target tab at start of agent loop — survives user switching tabs
let lockedTabId = null;

async function getTargetTab() {
  if (lockedTabId) {
    try {
      const tab = await chrome.tabs.get(lockedTabId);
      // Trust an explicit lock even if URL is chrome:// (e.g. newtab pages
      // the hook caller intends to navigate away from). The chrome:// guard
      // below only applies to auto-discovery, not explicit hook-set locks.
      if (tab) return lockedTabId;
    } catch {}
    lockedTabId = null;
  }
  // Query active tab in THIS sidepanel's window first
  if (currentWindowId && typeof currentWindowId === 'number') {
    const tabs = await chrome.tabs.query({ active: true, windowId: currentWindowId });
    const tab = tabs.find(t => !t.url?.startsWith('chrome-extension://') && !t.url?.startsWith('chrome://'));
    if (tab) { lockedTabId = tab.id; return tab.id; }
  }
  // Fallback: last focused window
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tab = tabs.find(t => !t.url?.startsWith('chrome-extension://') && !t.url?.startsWith('chrome://'));
  if (!tab) { const all = await chrome.tabs.query({}); tab = all.find(t => t.url?.startsWith('http')); }
  if (!tab) throw new Error('No browser tab found. Open a webpage first.');
  lockedTabId = tab.id;
  return tab.id;
}

async function injectContentScript(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] }); } catch {}
  // Install ref resolver that adds a stable-selector fallback over the WeakRef
  // map. Without it, any DOM re-render (SPA virtual list, Vue key rotation, GC)
  // permanently invalidates refs and the agent has to re-read the page.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      if (window.__clawlineResolveRef) return;
      window.__clawlineSelectorCache = window.__clawlineSelectorCache || {};
      const _esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
      function buildSelector(el) {
        if (!el || el.nodeType !== 1) return null;
        if (el.id) {
          const sel = '#' + _esc(el.id);
          try { if (document.querySelector(sel) === el) return sel; } catch {}
        }
        const tid = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-cy');
        if (tid) {
          const sel = `[data-testid="${tid.replace(/"/g, '\\"')}"]`;
          try { if (document.querySelector(sel) === el) return sel; } catch {}
        }
        const al = el.getAttribute('aria-label');
        if (al && al.length < 80) {
          const sel = `${el.tagName.toLowerCase()}[aria-label="${al.replace(/"/g, '\\"')}"]`;
          try { if (document.querySelector(sel) === el) return sel; } catch {}
        }
        const name = el.getAttribute('name');
        if (name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
          const sel = `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
          try { if (document.querySelector(sel) === el) return sel; } catch {}
        }
        // nth-of-type path, anchored to nearest ancestor with id (or to body).
        const path = [];
        let cur = el, depth = 0;
        while (cur && cur.nodeType === 1 && cur !== document.body && depth < 8) {
          let sib = cur, n = 1;
          while ((sib = sib.previousElementSibling)) { if (sib.tagName === cur.tagName) n++; }
          path.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${n})`);
          if (cur.parentElement?.id) { path.unshift('#' + _esc(cur.parentElement.id)); break; }
          cur = cur.parentElement;
          depth++;
        }
        if (!path.length) return null;
        const sel = path.join(' > ');
        try { if (document.querySelector(sel) === el) return sel; } catch {}
        return null;
      }
      window.__clawlineRememberSelector = (refId, el) => {
        if (!el) return;
        const sel = buildSelector(el);
        if (sel) window.__clawlineSelectorCache[refId] = sel;
      };
      window.__clawlineResolveRef = (refId) => {
        const map = window.__clawlineElementMap || (window.__clawlineElementMap = {});
        const wref = map[refId];
        const live = wref ? wref.deref() : null;
        if (live && document.contains(live)) {
          window.__clawlineRememberSelector(refId, live);
          return live;
        }
        const sel = window.__clawlineSelectorCache[refId];
        if (sel) {
          try {
            const found = document.querySelector(sel);
            if (found) { map[refId] = new WeakRef(found); return found; }
          } catch {}
        }
        return null;
      };
      // Pre-cache selectors for all currently-mapped refs (typically populated
      // by the most recent read_page) so the fallback is ready before the
      // first ref-using tool runs.
      const map = window.__clawlineElementMap || {};
      for (const refId of Object.keys(map)) {
        const el = map[refId]?.deref?.();
        if (el && document.contains(el)) window.__clawlineRememberSelector(refId, el);
      }
    }});
  } catch {}
}

async function executeTool(name, args) {
  // Global timeout: if any tool takes over 60s, abort with error
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool "${name}" timed out after 60s`)), 60000);
    _executeTool(name, args)
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

async function _executeTool(name, args) {
  const tabId = ['tabs_create', 'tabs_context'].includes(name) ? null : await getTargetTab();

  switch (name) {
    case 'computer': {
      const action = args.action;
      if (action === 'screenshot') {
        await ensureDebugger(tabId);
        const layoutMetrics = await cdp('Page.getLayoutMetrics');
        const vw = layoutMetrics.cssVisualViewport?.clientWidth || 1280;
        const vh = layoutMetrics.cssVisualViewport?.clientHeight || 720;
        const [sw, sh] = calcSSDimensions(vw, vh);
        const scale = sw < vw ? sw / vw : 1;
        let quality = SS_INIT_QUALITY, result;
        while (quality >= SS_MIN_QUALITY) {
          result = await cdp('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false, fromSurface: true, clip: { x: 0, y: 0, width: vw, height: vh, scale } });
          if (result.data.length <= SS_MAX_B64) break;
          quality -= SS_QUALITY_STEP;
        }
        lastViewport = { vw, vh, sw, sh };
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: result.data } }] };
      }
      if (action === 'wait') {
        const duration = Math.min(args.duration || 2, 10);
        await new Promise(r => setTimeout(r, duration * 1000));
        return { content: [{ type: 'text', text: `Waited ${duration}s` }] };
      }
      if (['left_click', 'right_click', 'double_click', 'triple_click'].includes(action)) {
        if (args.ref) {
          await injectContentScript(tabId);
          const results = await chrome.scripting.executeScript({ target: { tabId }, func: (refId, action) => {
            const el = window.__clawlineResolveRef ? window.__clawlineResolveRef(refId) : (window.__clawlineElementMap?.[refId]?.deref() || null);
            if (!el || !document.contains(el)) {
              if (window.__clawlineElementMap) delete window.__clawlineElementMap[refId];
              return { error: `Element ${refId} no longer exists. Re-run read_page to refresh element refs.` };
            }
            el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
            if (action === 'left_click' || !action) el.click();
            return { success: true, coordinates: [Math.round(x), Math.round(y)], tag: el.tagName, text: (el.textContent || '').slice(0, 50) };
          }, args: [args.ref, action] });
          const r = results?.[0]?.result;
          if (r?.error) return { content: [{ type: 'text', text: r.error }] };
          if (action !== 'left_click' && r?.coordinates) {
            const [x, y] = r.coordinates;
            const count = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
            const button = action === 'right_click' ? 'right' : 'left';
            await ensureDebugger(tabId);
            await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count });
            await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count });
          }
          const waitInfo = await postActionWait(tabId, args);
          return { content: [{ type: 'text', text: `Clicked ${args.ref} <${r?.tag}> "${r?.text}"${waitInfo}` }] };
        }
        if (!args.coordinate) return { content: [{ type: 'text', text: 'Click requires either ref or coordinate parameter' }] };
        const [x, y] = scaleCoordinate(...args.coordinate);
        const count = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
        const button = action === 'right_click' ? 'right' : 'left';
        await ensureDebugger(tabId);
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count });
        const waitInfo = await postActionWait(tabId, args);
        return { content: [{ type: 'text', text: `Clicked [${x},${y}]${waitInfo}` }] };
      }
      if (action === 'type') {
        await ensureDebugger(tabId);
        await cdp('Input.insertText', { text: args.text });
        return { content: [{ type: 'text', text: `Typed: ${args.text?.slice(0, 50)}` }] };
      }
      if (action === 'key') {
        await ensureDebugger(tabId);
        const keys = args.text.split(' ');
        const repeat = args.repeat || 1;
        // Extended keycode map covers function keys, navigation, and editing keys
        // that the previous charCodeAt fallback got wrong.
        const namedKey = {
          Enter: 13, Return: 13, Tab: 9, Escape: 27, Esc: 27, Backspace: 8, Space: 32,
          Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34,
          ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
          F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
          F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
        };
        const keyCode = (k) => namedKey[k] != null ? namedKey[k] : k.toUpperCase().charCodeAt(0);
        for (let r = 0; r < repeat; r++) {
          for (const k of keys) {
            if (k.includes('+')) {
              const parts = k.split('+');
              const modMap = { ctrl: 'Control', cmd: 'Meta', meta: 'Meta', alt: 'Alt', shift: 'Shift' };
              const mods = parts.slice(0, -1);
              const main = parts[parts.length - 1];
              let modBits = 0;
              for (const m of mods) { if (m === 'alt') modBits |= 1; if (m === 'ctrl') modBits |= 2; if (m === 'meta' || m === 'cmd') modBits |= 4; if (m === 'shift') modBits |= 8; }
              const pressedMods = [];
              try {
                for (const m of mods) {
                  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: modMap[m] || m, modifiers: modBits });
                  pressedMods.push(m);
                }
                const vk = keyCode(main);
                await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: main, windowsVirtualKeyCode: vk, modifiers: modBits });
                await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: main, windowsVirtualKeyCode: vk, modifiers: modBits });
              } finally {
                // Always release modifiers, even if the main key dispatch threw —
                // otherwise the page is stuck with Ctrl/Shift held until reload.
                for (const m of pressedMods.reverse()) {
                  try { await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: modMap[m] || m }); } catch {}
                }
              }
            } else {
              const code = keyCode(k);
              await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, windowsVirtualKeyCode: code });
              await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code });
            }
          }
        }
        const waitInfo = await postActionWait(tabId, args);
        return { content: [{ type: 'text', text: `Key: ${args.text}${(args.repeat || 1) > 1 ? ` x${args.repeat}` : ''}${waitInfo}` }] };
      }
      if (action === 'scroll') {
        const [x, y] = args.coordinate ? scaleCoordinate(...args.coordinate) : [400, 400];
        const dir = args.scroll_direction || 'down';
        const ticks = args.scroll_amount || 3;
        const dx = dir === 'left' ? -ticks * 120 : dir === 'right' ? ticks * 120 : 0;
        const dy = dir === 'up' ? -ticks * 120 : dir === 'down' ? ticks * 120 : 0;
        await ensureDebugger(tabId);
        await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
        return { content: [{ type: 'text', text: `Scrolled ${dir} ${ticks} ticks` }] };
      }
      if (action === 'hover') {
        if (args.ref) {
          await injectContentScript(tabId);
          const results = await chrome.scripting.executeScript({ target: { tabId }, func: (refId) => {
            const el = window.__clawlineResolveRef ? window.__clawlineResolveRef(refId) : (window.__clawlineElementMap?.[refId]?.deref() || null);
            if (!el) return { error: `Element ${refId} not found. Re-run read_page to refresh element refs.` };
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            const rect = el.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
          }, args: [args.ref] });
          const r = results?.[0]?.result;
          if (r?.error) return { content: [{ type: 'text', text: r.error }] };
          await ensureDebugger(tabId);
          await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
          return { content: [{ type: 'text', text: `Hovered ${args.ref}` }] };
        }
        if (!args.coordinate) return { content: [{ type: 'text', text: 'hover requires ref or coordinate' }] };
        const [x, y] = scaleCoordinate(...args.coordinate);
        await ensureDebugger(tabId);
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        return { content: [{ type: 'text', text: `Hovered [${x},${y}]` }] };
      }
      if (action === 'left_click_drag') {
        const [sx, sy] = scaleCoordinate(...args.start_coordinate);
        const [ex, ey] = scaleCoordinate(...args.coordinate);
        await ensureDebugger(tabId);
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy, button: 'none' });
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 5; i++) {
          await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(sx + (ex-sx)*i/5), y: Math.round(sy + (ey-sy)*i/5), button: 'left', buttons: 1 });
        }
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1 });
        return { content: [{ type: 'text', text: `Dragged [${sx},${sy}] → [${ex},${ey}]` }] };
      }
      if (action === 'zoom') {
        // Capture a specific region at full resolution for inspection
        // Scale coordinates from screenshot space to viewport space
        const raw = args.region || [0, 0, 400, 300];
        const [sx0, sy0] = scaleCoordinate(raw[0], raw[1]);
        const [sx1, sy1] = scaleCoordinate(raw[2], raw[3]);
        await ensureDebugger(tabId);
        const result = await cdp('Page.captureScreenshot', {
          format: 'jpeg', quality: 90, captureBeyondViewport: false, fromSurface: true,
          clip: { x: sx0, y: sy0, width: sx1 - sx0, height: sy1 - sy0, scale: 2 },
        });
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: result.data } }] };
      }
      if (action === 'scroll_to') {
        if (!args.ref) return { content: [{ type: 'text', text: 'scroll_to requires ref parameter' }] };
        await injectContentScript(tabId);
        const results = await chrome.scripting.executeScript({ target: { tabId }, func: (refId) => {
          const el = window.__clawlineResolveRef ? window.__clawlineResolveRef(refId) : (window.__clawlineElementMap?.[refId]?.deref() || null);
          if (!el) return { error: `Element ${refId} not found. Re-run read_page to refresh element refs.` };
          el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          return { success: true, tag: el.tagName };
        }, args: [args.ref] });
        const r = results?.[0]?.result;
        if (r?.error) return { content: [{ type: 'text', text: r.error }] };
        return { content: [{ type: 'text', text: `Scrolled to ${args.ref} <${r?.tag}>` }] };
      }
      return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
    }

    case 'read_page': {
      await injectContentScript(tabId);
      const filter = args.filter || 'all';
      const maxChars = args.max_chars || 15000;
      // Force minimum 15000 chars to avoid content script "exceeds limit" errors
      const effectiveMaxChars = Math.max(maxChars, 15000);
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (f, d, mc, ri) => {
        if (typeof window.__generateAccessibilityTree === 'function') return window.__generateAccessibilityTree(f, d, mc, ri);
        return { error: 'Content script not loaded. Try again.', pageContent: '', viewport: { width: window.innerWidth, height: window.innerHeight } };
      }, args: [filter, args.depth || 10, effectiveMaxChars, args.ref_id || null] });
      const result = results?.[0]?.result;
      if (result?.error) {
        // If character limit error, retry with larger limit
        if (result.error.includes('character limit')) {
          const retry = await chrome.scripting.executeScript({ target: { tabId }, func: (f, d, mc, ri) => {
            if (typeof window.__generateAccessibilityTree === 'function') return window.__generateAccessibilityTree(f, d, mc, ri);
            return { error: 'Content script not loaded.', pageContent: '', viewport: { width: window.innerWidth, height: window.innerHeight } };
          }, args: [filter, args.depth || 5, 50000, args.ref_id || null] });
          const r2 = retry?.[0]?.result;
          if (!r2?.error) {
            const vp2 = r2?.viewport;
            return { content: [{ type: 'text', text: (vp2 ? `[Viewport: ${vp2.width}x${vp2.height}]\n` : '') + (r2?.pageContent || 'Empty page') }] };
          }
        }
        return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
      }
      const vp = result?.viewport;
      return { content: [{ type: 'text', text: (vp ? `[Viewport: ${vp.width}x${vp.height}]\n` : '') + (result?.pageContent || 'Empty page') }] };
    }

    case 'find': {
      await injectContentScript(tabId);
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (query) => {
        const matches = [];
        const all = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex], h1, h2, h3, h4, h5, h6, label, img, [contenteditable]');
        const q = query.toLowerCase();
        for (const el of all) {
          const text = (el.textContent || '').trim().slice(0, 100);
          const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || el.getAttribute('title') || '';
          const combined = (text + ' ' + label).toLowerCase();
          if (!combined.includes(q) && !el.tagName.toLowerCase().includes(q)) continue;
          let refId;
          for (const d in window.__clawlineElementMap) { if (window.__clawlineElementMap[d]?.deref() === el) { refId = d; break; } }
          if (!refId) { refId = 'ref_' + (++window.__clawlineRefCounter); window.__clawlineElementMap[refId] = new WeakRef(el); }
          if (window.__clawlineRememberSelector) window.__clawlineRememberSelector(refId, el);
          const rect = el.getBoundingClientRect();
          matches.push({ ref: refId, tag: el.tagName.toLowerCase(), text: text.slice(0, 60), label: label.slice(0, 40), visible: rect.width > 0 && rect.height > 0 });
          if (matches.length >= 20) break;
        }
        return matches;
      }, args: [args.query] });
      const found = results?.[0]?.result || [];
      if (found.length === 0) return { content: [{ type: 'text', text: `No elements found matching "${args.query}"` }] };
      const lines = found.map(f => `${f.ref} <${f.tag}> "${f.text || f.label}"${f.visible ? '' : ' (hidden)'}`);
      return { content: [{ type: 'text', text: `Found ${found.length} elements:\n${lines.join('\n')}` }] };
    }

    case 'form_input': {
      await injectContentScript(tabId);
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (ref, value) => {
        const el = window.__clawlineResolveRef ? window.__clawlineResolveRef(ref) : (window.__clawlineElementMap?.[ref]?.deref() || null);
        if (!el || !document.contains(el)) {
          if (window.__clawlineElementMap) delete window.__clawlineElementMap[ref];
          return { error: `Element ${ref} no longer exists. Re-run read_page to refresh element refs.` };
        }
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        const tag = el.tagName.toLowerCase();
        if (tag === 'select') {
          const opts = Array.from(el.options);
          const opt = opts.find(o => o.value === String(value) || o.text.trim() === String(value));
          if (!opt) return { error: `No option matching "${value}". Available: ${opts.map(o => o.value).slice(0, 10).join(', ')}` };
          el.value = opt.value;
        } else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
          el.checked = !!value;
        } else if ('value' in el) {
          el.value = String(value);
          try { el.setSelectionRange?.(el.value.length, el.value.length); } catch {} // throws on date/time/number/range inputs
        } else if (el.isContentEditable) {
          el.textContent = String(value);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, tag, value: ('value' in el) ? el.value?.slice(0, 50) : String(value).slice(0, 50) };
      }, args: [args.ref, args.value] });
      const r = results?.[0]?.result;
      if (r?.error) return { content: [{ type: 'text', text: r.error }] };
      return { content: [{ type: 'text', text: `Set ${args.ref} <${r?.tag}> = "${r?.value}"` }] };
    }

    case 'batch_form_input': {
      await injectContentScript(tabId);
      const fields = args.fields || [];
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (fieldsArr) => {
        const map = window.__clawlineElementMap;
        if (!map) return { error: 'Element map not available. Use read_page first.' };
        const outcomes = [];
        for (const { ref, value } of fieldsArr) {
          const el = window.__clawlineResolveRef ? window.__clawlineResolveRef(ref) : (map[ref]?.deref() || null);
          if (!el || !document.contains(el)) {
            delete map[ref];
            outcomes.push({ ref, error: `${ref} no longer exists. Re-run read_page to refresh element refs.` });
            continue;
          }
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.focus();
          const tag = el.tagName.toLowerCase();
          if (tag === 'select') {
            const opts = Array.from(el.options);
            const opt = opts.find(o => o.value === String(value) || o.text.trim() === String(value));
            if (!opt) {
              outcomes.push({ ref, ok: false, error: `No option matching "${value}". Available: ${opts.map(o => o.value).slice(0, 10).join(', ')}` });
              continue;
            }
            el.value = opt.value;
          } else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
            el.checked = !!value;
          } else if ('value' in el) {
            el.value = String(value);
            try { el.setSelectionRange?.(el.value.length, el.value.length); } catch {} // throws on date/time/number/range inputs
          } else if (el.isContentEditable) {
            el.textContent = String(value);
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          outcomes.push({ ref, ok: true, tag, val: ('value' in el) ? el.value?.slice(0, 30) : String(value).slice(0, 30) });
        }
        return { outcomes };
      }, args: [fields] });
      const r = results?.[0]?.result;
      if (r?.error) return { content: [{ type: 'text', text: r.error }] };
      // Optionally click a button after filling
      if (args.click_after) {
        const clickResults = await chrome.scripting.executeScript({ target: { tabId }, func: (refId) => {
          const el = window.__clawlineResolveRef ? window.__clawlineResolveRef(refId) : (window.__clawlineElementMap?.[refId]?.deref() || null);
          if (!el) return { error: `${refId} not found. Re-run read_page to refresh element refs.` };
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.click();
          return { ok: true, tag: el.tagName, text: (el.textContent || '').slice(0, 30) };
        }, args: [args.click_after] });
        const cr = clickResults?.[0]?.result;
        if (cr?.error) {
          const summary = (r.outcomes || []).map(o => o.ok ? `${o.ref}="${o.val}"` : `${o.ref} FAIL`).join(', ');
          return { content: [{ type: 'text', text: `Set ${summary}. Click ${args.click_after} failed: ${cr.error}` }] };
        }
      }
      const summary = (r.outcomes || []).map(o => o.ok ? `${o.ref}="${o.val}"` : `${o.ref} FAIL: ${o.error}`).join(', ');
      const clickNote = args.click_after ? ` → clicked ${args.click_after}` : '';
      return { content: [{ type: 'text', text: `Batch set ${fields.length} fields: ${summary}${clickNote}` }] };
    }

    case 'navigate': {
      const url = args.url;
      // Whitelist protocols — block javascript:/data:/file: even from prompt-injected input.
      const allowSpecial = url === 'back' || url === 'forward' || url === 'about:blank';
      if (!allowSpecial) {
        const normalized = url.startsWith('http') ? url : 'https://' + url;
        if (!/^https?:\/\//i.test(normalized) && normalized !== 'about:blank') {
          return { content: [{ type: 'text', text: `Refused: only http(s) URLs allowed, got: ${url}` }] };
        }
      }
      if (url === 'back') await chrome.tabs.goBack(tabId);
      else if (url === 'forward') await chrome.tabs.goForward(tabId);
      else await chrome.tabs.update(tabId, { url: url.startsWith('http') ? url : 'https://' + url });
      const condition = args.wait_for || 'load';
      const timeout = Math.min(args.wait_timeout || 10, 30) * 1000;
      const reason = await waitForSettle(tabId, { condition, selector: args.wait_for_selector, timeout });
      const tab = await chrome.tabs.get(tabId);
      return { content: [{ type: 'text', text: `Navigated to: ${tab.url} (${condition}=${reason})` }] };
    }

    case 'get_page_text': {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (maxChars) => {
        const article = document.querySelector('article') || document.querySelector('[role="main"]') || document.body;
        return (article.innerText || article.textContent || '').slice(0, maxChars);
      }, args: [args.max_chars || 15000] });
      return { content: [{ type: 'text', text: results?.[0]?.result || 'Empty page' }] };
    }

    case 'tabs_create': {
      const tab = await chrome.tabs.create({ url: 'chrome://newtab' });
      return { content: [{ type: 'text', text: `Created tab ${tab.id}` }] };
    }

    case 'tabs_context': {
      const tabs = await chrome.tabs.query({});
      const list = tabs.filter(t => !t.url?.startsWith('chrome-extension://')).map(t => ({ tabId: t.id, title: t.title?.slice(0, 60), url: t.url?.slice(0, 80), active: t.active, locked: t.id === lockedTabId }));
      return { content: [{ type: 'text', text: `Current locked tab: ${lockedTabId || 'none'}\n${JSON.stringify(list, null, 2)}` }] };
    }

    case 'read_console_messages': {
      await ensureDebugger(tabId);
      await cdp('Runtime.enable');
      // Collect console messages via CDP — read existing ones
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (onlyErrors, pattern, limit) => {
        // Intercept console if not already done
        if (!window.__clawlineConsoleMsgs) {
          window.__clawlineConsoleMsgs = [];
          const orig = {};
          for (const m of ['log','warn','error','info','debug']) {
            orig[m] = console[m];
            console[m] = function(...args) {
              window.__clawlineConsoleMsgs.push({ type: m, text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), ts: Date.now() });
              if (window.__clawlineConsoleMsgs.length > 500) window.__clawlineConsoleMsgs.shift();
              orig[m].apply(console, args);
            };
          }
          window.addEventListener('error', e => window.__clawlineConsoleMsgs.push({ type: 'exception', text: e.message + ' at ' + e.filename + ':' + e.lineno, ts: Date.now() }));
        }
        let msgs = window.__clawlineConsoleMsgs;
        if (onlyErrors) msgs = msgs.filter(m => m.type === 'error' || m.type === 'exception');
        if (pattern) { const re = new RegExp(pattern, 'i'); msgs = msgs.filter(m => re.test(m.text)); }
        return msgs.slice(-(limit || 100));
      }, args: [args.onlyErrors || false, args.pattern || null, args.limit || 100] });
      const msgs = results?.[0]?.result || [];
      if (args.clear) await chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__clawlineConsoleMsgs = []; } });
      if (msgs.length === 0) return { content: [{ type: 'text', text: 'No console messages found.' }] };
      const lines = msgs.map(m => `[${m.type}] ${m.text}`).join('\n');
      return { content: [{ type: 'text', text: `${msgs.length} console messages:\n${lines}` }] };
    }

    case 'read_network_requests': {
      await ensureDebugger(tabId);
      // Network capture state lives on window for cross-call persistence; the
      // Map is keyed by CDP requestId so requests with the same URL don't
      // collide, and entries evict in insertion order when the cap is hit.
      const NET_MAX = 500;
      if (!window.__clawlineNetworkEnabled) {
        window.__clawlineNetworkRequests = new Map();
        await cdp('Network.enable');
        if (_debuggerEventListener) {
          chrome.debugger.onEvent.removeListener(_debuggerEventListener);
        }
        _debuggerEventListener = (source, method, params) => {
          if (source.tabId !== debuggerTabId) return;
          const map = window.__clawlineNetworkRequests;
          if (!map) return;
          const evict = () => {
            while (map.size > NET_MAX) {
              const firstKey = map.keys().next().value;
              if (firstKey === undefined) break;
              map.delete(firstKey);
            }
          };
          if (method === 'Network.requestWillBeSent' && params.requestId) {
            map.set(params.requestId, {
              id: params.requestId,
              url: params.request.url,
              method: params.request.method,
              type: params.type,
              status: 0,
              ts: Date.now(),
            });
            evict();
          } else if (method === 'Network.responseReceived' && params.requestId) {
            const entry = map.get(params.requestId);
            if (entry) {
              entry.status = params.response.status;
              entry.mimeType = params.response.mimeType;
            }
          } else if (method === 'Network.loadingFinished' && params.requestId) {
            const entry = map.get(params.requestId);
            if (entry) entry.duration = Date.now() - entry.ts;
          } else if (method === 'Network.loadingFailed' && params.requestId) {
            const entry = map.get(params.requestId);
            if (entry) {
              entry.status = 0;
              entry.error = params.errorText || 'failed';
              entry.duration = Date.now() - entry.ts;
            } else {
              map.set(params.requestId, { id: params.requestId, url: '?', method: '?', status: 0, error: params.errorText || 'failed', ts: Date.now() });
              evict();
            }
          }
        };
        chrome.debugger.onEvent.addListener(_debuggerEventListener);
        window.__clawlineNetworkEnabled = true;
      }
      let reqs = Array.from(window.__clawlineNetworkRequests?.values() || []);
      if (args.urlPattern) reqs = reqs.filter(r => r.url?.includes(args.urlPattern));
      reqs = reqs.slice(-(args.limit || 100));
      if (args.clear) { window.__clawlineNetworkRequests?.clear(); }
      if (reqs.length === 0) return { content: [{ type: 'text', text: 'No network requests captured. Note: requests made before monitoring started cannot be captured.' }] };
      const lines = reqs.map(r => {
        const tag = r.error ? `ERR(${r.error})` : (r.status || 'pending');
        const dur = r.duration != null ? ` (${r.duration}ms)` : '';
        return `${r.method || '?'} ${tag} ${r.url?.slice(0, 120)}${dur}`;
      }).join('\n');
      return { content: [{ type: 'text', text: `${reqs.length} requests:\n${lines}` }] };
    }

    case 'resize_window': {
      const win = await chrome.windows.getCurrent();
      await chrome.windows.update(win.id, { width: args.width, height: args.height });
      return { content: [{ type: 'text', text: `Resized to ${args.width}x${args.height}` }] };
    }

    case 'emulate_device': {
      const presets = {
        'iPhone 14':          { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
        'iPhone 14 Pro Max':  { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
        'iPhone SE':          { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
        'iPad':               { width: 810, height: 1080, deviceScaleFactor: 2, mobile: true, ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
        'iPad Pro':           { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true, ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
        'Pixel 7':            { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
        'Galaxy S23':         { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, ua: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
      };
      await ensureDebugger(tabId);
      if (args.preset === 'desktop' && !args.width) {
        await cdp('Emulation.clearDeviceMetricsOverride');
        await cdp('Emulation.setUserAgentOverride', { userAgent: navigator.userAgent });
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
        // Repopulate from the real viewport so a click before the next screenshot
        // still resolves to sensible CSS pixel coordinates.
        try {
          const lm = await cdp('Page.getLayoutMetrics');
          const vw = lm.cssVisualViewport?.clientWidth || 0;
          const vh = lm.cssVisualViewport?.clientHeight || 0;
          if (vw && vh) lastViewport = { vw, vh, sw: vw, sh: vh };
          else lastViewport = { vw: 0, vh: 0, sw: 0, sh: 0 };
        } catch { lastViewport = { vw: 0, vh: 0, sw: 0, sh: 0 }; }
        return { content: [{ type: 'text', text: 'Reset to desktop mode. Take a screenshot before clicking — previous coordinates are now invalid.' }] };
      }
      const p = presets[args.preset] || {};
      const w = args.width || p.width || 390;
      const h = args.height || p.height || 844;
      const dpr = args.deviceScaleFactor != null ? args.deviceScaleFactor : (p.deviceScaleFactor || 2);
      const mob = args.mobile !== undefined ? args.mobile : (p.mobile !== undefined ? p.mobile : true);
      const ua = p.ua || '';
      await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: mob });
      if (ua) await cdp('Emulation.setUserAgentOverride', { userAgent: ua });
      await cdp('Emulation.setTouchEmulationEnabled', { enabled: mob });
      // Pre-seed viewport so coordinate scaling works before the next screenshot.
      // sw/sh equal vw/vh because no clip.scale has been applied yet.
      lastViewport = { vw: w, vh: h, sw: w, sh: h };
      const label = args.preset && args.preset !== 'desktop' ? `${args.preset} (${w}x${h} @${dpr}x)` : `${w}x${h} @${dpr}x`;
      return { content: [{ type: 'text', text: `Emulating: ${label}${mob ? ' [mobile]' : ''}. Take a screenshot before clicking — previous coordinates are now invalid.` }] };
    }

    case 'javascript_tool': {
      // Use CDP Runtime.evaluate to bypass page CSP (eval blocked on many sites)
      await ensureDebugger(tabId);
      try {
        const result = await cdp('Runtime.evaluate', {
          expression: args.text,
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails) {
          const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Unknown error';
          return { content: [{ type: 'text', text: 'Error: ' + errMsg }] };
        }
        return { content: [{ type: 'text', text: String(result.result?.value ?? 'undefined') }] };
      } catch (e) {
        return { content: [{ type: 'text', text: 'Error: ' + e.message }] };
      }
    }

    case 'file_upload': {
      if (!args.paths?.length || !args.ref) return { content: [{ type: 'text', text: 'paths and ref are required' }] };
      await injectContentScript(tabId);
      await ensureDebugger(tabId);
      // Get the element's CDP object ID via Runtime.evaluate
      const evalResult = await chrome.scripting.executeScript({ target: { tabId }, func: (refId) => {
        const el = window.__clawlineResolveRef ? window.__clawlineResolveRef(refId) : (window.__clawlineElementMap?.[refId]?.deref() || null);
        if (!el) return { error: `Element ${refId} not found. Re-run read_page to refresh element refs.` };
        // Tag element for CDP lookup
        const attr = '__clawline_file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        el.setAttribute(attr, '1');
        return { attr, tag: el.tagName };
      }, args: [args.ref] });
      const r = evalResult?.[0]?.result;
      if (r?.error) return { content: [{ type: 'text', text: r.error }] };
      // Find element in CDP DOM
      await cdp('DOM.enable');
      const doc = await cdp('DOM.getDocument');
      const node = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `[${r.attr}]` });
      if (!node?.nodeId) { await cdp('DOM.disable'); return { content: [{ type: 'text', text: 'Could not find element via CDP' }] }; }
      await cdp('DOM.setFileInputFiles', { files: args.paths, nodeId: node.nodeId });
      // Cleanup attribute
      await chrome.scripting.executeScript({ target: { tabId }, func: (attr) => {
        const el = document.querySelector(`[${attr}]`);
        if (el) el.removeAttribute(attr);
      }, args: [r.attr] });
      await cdp('DOM.disable');
      return { content: [{ type: 'text', text: `Uploaded ${args.paths.length} file(s) to ${args.ref}` }] };
    }

    case 'update_plan': {
      const steps = args.approach?.join('\n• ') || '';
      const domains = args.domains?.join(', ') || '';
      return { content: [{ type: 'text', text: `Plan updated:\nDomains: ${domains}\nSteps:\n• ${steps}` }] };
    }

    case 'turn_answer_start': {
      return { content: [{ type: 'text', text: 'Proceeding with response.' }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// ── API Retry ──

async function fetchWithRetry(url, opts, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok || res.status < 429) return res;
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxRetries) return res;
      const wait = Math.min(1000 * Math.pow(2, attempt), 8000);
      const retryAfter = res.headers.get('retry-after');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : wait;
      setStatus(`Retrying in ${Math.round(delay/1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}

// ── SSE Parser ──

async function* parseSSE(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (d === '[DONE]') return;
      try { yield JSON.parse(d); } catch {}
    }
  }
}

// ── Conversation Pruning ──
// Original extension sends ALL messages unmodified.
// We only strip base64 images and truncate long text from older messages to save tokens.
// NEVER delete messages — that breaks tool_use/tool_result pairing.

const MAX_TOOL_TEXT = 500;
const RECENT_KEEP = 20; // Keep last 20 messages fully intact (10 agent turns)

function pruneConversation(messages) {
  if (messages.length <= RECENT_KEEP) return messages;

  return messages.map((msg, i) => {
    // Keep recent messages intact
    if (i >= messages.length - RECENT_KEEP) return msg;
    // Keep simple text messages as-is
    if (typeof msg.content === 'string') return msg;
    if (!Array.isArray(msg.content)) return msg;

    return { ...msg, content: msg.content.map(block => {
      // Strip base64 images from older messages
      if (block.type === 'image') return { type: 'text', text: '[screenshot removed to save tokens]' };
      // Truncate long text (e.g. old read_page results)
      if (block.type === 'text' && block.text?.length > MAX_TOOL_TEXT) {
        return { type: 'text', text: block.text.slice(0, MAX_TOOL_TEXT) + '...[truncated]' };
      }
      // Keep tool_use intact (id/name/input required by API)
      if (block.type === 'tool_use') return block;
      // Strip images inside tool_result, truncate text
      if (block.type === 'tool_result') {
        if (typeof block.content === 'string') {
          return block.content.length > MAX_TOOL_TEXT ? { ...block, content: block.content.slice(0, MAX_TOOL_TEXT) + '...[truncated]' } : block;
        }
        if (Array.isArray(block.content)) {
          return { ...block, content: block.content.map(b => {
            if (b.type === 'image') return { type: 'text', text: '[screenshot]' };
            if (b.type === 'text' && b.text?.length > MAX_TOOL_TEXT) return { type: 'text', text: b.text.slice(0, MAX_TOOL_TEXT) + '...[truncated]' };
            return b;
          }) };
        }
        return block;
      }
      // Keep thinking blocks but truncate
      if (block.type === 'thinking' && block.thinking?.length > MAX_TOOL_TEXT) {
        return { ...block, thinking: block.thinking.slice(0, MAX_TOOL_TEXT) + '...[truncated]' };
      }
      return block;
    }) };
  });
}

// ── Agent Loop ──

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isRunning) return;
  inputEl.value = ''; inputEl.style.height = 'auto';
  // Collapse previous groups before new message
  messagesEl.querySelectorAll('.tool-group:not(.collapsed)').forEach(g => {
    g.classList.add('collapsed');
    const arrow = g.querySelector('.tool-group-arrow');
    if (arrow) arrow.textContent = '\u203A';
  });
  addMsg('user', text);
  const userContent = [];
  for (const img of pendingImages) userContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  userContent.push({ type: 'text', text });
  conversation.push({ role: 'user', content: userContent.length === 1 ? text : userContent });
  pendingImages = []; attachmentsEl.innerHTML = '';
  await runAgentLoop();
}

async function runAgentLoop() {
  // ── DIAGNOSTIC (perf-baseline triage) — remove after debugging ──
  const _diag = (label, data) => {
    try {
      swPort?.postMessage({
        type: 'error_log',
        error: {
          message: `[DIAG ${label}] ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 600)}`,
          from: 'sidepanel-diag',
          timestamp: new Date().toISOString(),
        },
      });
    } catch {}
    try { console.log(`[DIAG ${label}]`, data); } catch {}
  };
  _diag('enter', { API_URL, hasKey: !!API_KEY, model: getModel(), thinking: thinkingEnabled, fast: fastMode, convLen: conversation.length, maxLoops: getMaxLoops() });

  setRunning(true);
  abortController = new AbortController();

  try {
    for (let step = 1; step <= getMaxLoops(); step++) {
      setStatus(`Step ${step}...`);

      const prunedMessages = pruneConversation(conversation);

      // Add cache_control to the last assistant message's last content block (immutable — never mutate conversation)
      let lastAsstIdx = -1;
      for (let i = prunedMessages.length - 1; i >= 0; i--) {
        if (prunedMessages[i].role === 'assistant' && Array.isArray(prunedMessages[i].content) && prunedMessages[i].content.length > 0) {
          lastAsstIdx = i;
          break;
        }
      }
      const messagesForAPI = lastAsstIdx === -1 ? prunedMessages : prunedMessages.map((msg, i) => {
        if (i !== lastAsstIdx || !Array.isArray(msg.content)) return msg;
        return { ...msg, content: msg.content.map((block, j) =>
          j === msg.content.length - 1 ? { ...block, cache_control: { type: 'ephemeral' } } : block
        ) };
      });

      const body = {
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        tools: TOOLS,
        messages: messagesForAPI,
        stream: true,
      };
      if (thinkingEnabled) body.thinking = { type: 'enabled', budget_tokens: THINKING_BUDGET };

      _diag('pre-fetch', { step, url: `${API_URL}/v1/messages`, model: body.model, msgsLen: messagesForAPI.length, bodyBytes: JSON.stringify(body).length });
      const _t0 = performance.now();

      let res;
      try {
        res = await fetchWithRetry(`${API_URL}/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(API_KEY ? { 'x-api-key': API_KEY } : { 'Authorization': 'Bearer dev-local-token' }) },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });
      } catch (e) {
        _diag('fetch-throw', { step, ms: Math.round(performance.now() - _t0), err: e?.message, name: e?.name });
        throw e;
      }

      _diag('post-fetch', { step, ms: Math.round(performance.now() - _t0), status: res.status, ok: res.ok, ct: res.headers.get('content-type') });

      if (!res.ok) {
        const errText = await res.text();
        _diag('non-ok-break', { step, status: res.status, errText: errText.slice(0, 400) });
        reportApiError(`HTTP ${res.status} from ${API_URL}/v1/messages`, { status: res.status, body: errText.slice(0, 600), model: body.model, msgsLen: messagesForAPI.length });
        addMsg('system', `API Error ${res.status}: ${errText}`);
        break;
      }

      const blocks = [];
      let textDiv = null, textBuf = '', toolBuf = null, stopReason = null;
      // rAF-throttled renderer: SSE deltas can arrive thousands of times per
      // response; rendering Markdown on every delta caused O(N²) reflow.
      // Coalesce updates to one paint per frame, keyed by target div.
      const _pending = new Map(); // div → { text, isThinking }
      let _rafScheduled = false;
      const _flush = () => {
        _rafScheduled = false;
        for (const [div, { text, isThinking }] of _pending) {
          if (isThinking) div.textContent = text;
          else div.innerHTML = renderMarkdown(text);
        }
        _pending.clear();
        scrollBottom();
      };
      const _schedule = (div, text, isThinking) => {
        _pending.set(div, { text, isThinking });
        if (_rafScheduled) return;
        _rafScheduled = true;
        requestAnimationFrame(_flush);
      };
      const _flushDiv = (div) => {
        if (!_pending.has(div)) return;
        const { text, isThinking } = _pending.get(div);
        if (isThinking) div.textContent = text;
        else div.innerHTML = renderMarkdown(text);
        _pending.delete(div);
        scrollBottom();
      };

      try {
        for await (const evt of parseSSE(res)) {
          if (abortController.signal.aborted) break;
          switch (evt.type) {
            case 'content_block_start':
              if (evt.content_block?.type === 'text') { textDiv = addTextStep(); textBuf = ''; }
              else if (evt.content_block?.type === 'tool_use') { toolBuf = { id: evt.content_block.id, name: evt.content_block.name, input: '' }; }
              else if (evt.content_block?.type === 'thinking') { textDiv = addThinking(''); textBuf = ''; setStatus('Thinking...'); }
              break;
            case 'content_block_delta':
              if (evt.delta?.type === 'text_delta') { textBuf += evt.delta.text; if (textDiv) _schedule(textDiv, textBuf, false); }
              else if (evt.delta?.type === 'input_json_delta' && toolBuf) { toolBuf.input += evt.delta.partial_json; }
              else if (evt.delta?.type === 'thinking_delta') { textBuf += evt.delta.thinking; if (textDiv) _schedule(textDiv, textBuf, true); }
              break;
            case 'content_block_stop':
              // Flush any pending render for this block before finalizing
              if (textDiv) _flushDiv(textDiv);
              if (textBuf && textDiv && !textDiv.classList.contains('thinking')) {
                blocks.push({ type: 'text', text: textBuf });
              }
              if (toolBuf) {
                try { toolBuf.input = JSON.parse(toolBuf.input || '{}'); } catch { toolBuf.input = {}; }
                blocks.push({ type: 'tool_use', id: toolBuf.id, name: toolBuf.name, input: toolBuf.input });
                toolBuf = null;
              }
              textDiv = null; textBuf = '';
              break;
            case 'message_delta':
              if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
              break;
          }
        }
      } finally {
        // Always flush — covers abort, parseSSE throwing, and tab hidden
        // (rAF may not fire) so the persisted history reflects what we actually
        // received instead of dropping the trailing fragment.
        if (_pending.size) _flush();
      }

      if (abortController.signal.aborted) { _diag('aborted-after-sse', { step, blocksLen: blocks.length }); break; }
      _diag('post-sse', { step, blocksLen: blocks.length, types: blocks.map(b => b.type), stopReason });
      if (blocks.length > 0) conversation.push({ role: 'assistant', content: blocks });

      const toolUses = blocks.filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) { _diag('no-tools-break', { step, blocksLen: blocks.length, stopReason }); break; }

      // Execute tools
      const results = [];
      for (const tool of toolUses) {
        // Skip UI display for signal tools
        if (tool.name === 'turn_answer_start') {
          results.push({ type: 'tool_result', tool_use_id: tool.id, content: [{ type: 'text', text: 'Proceeding with response.' }] });
          continue;
        }
        setStatus(`${tool.name}...`);
        addToolCall(tool.name, tool.input);
        try {
          const result = await executeTool(tool.name, tool.input);
          if (result?.content) {
            for (const b of result.content) {
              if (b.type === 'image' && b.source?.data) addScreenshot(b.source.data, b.source.media_type);
              else if (b.type === 'text' && b.text) addToolResult(b.text);
            }
          }
          results.push({ type: 'tool_result', tool_use_id: tool.id, content: result?.content || [{ type: 'text', text: 'Done' }] });
        } catch (err) {
          addToolResult(`⚠ ${err.message}`);
          results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: [{ type: 'text', text: err.message }] });
        }
      }
      conversation.push({ role: 'user', content: results });
      if (stopReason === 'end_turn') break;
    }
  } catch (err) {
    if (err.name !== 'AbortError') { try { _diag('outer-catch', { name: err?.name, message: err?.message, stack: (err?.stack || '').split('\n').slice(0, 4).join(' | ') }); } catch {} reportApiError(`fetch threw: ${err?.name || 'Error'}: ${err?.message}`, { stack: (err?.stack || '').split('\n').slice(0, 4).join(' | ') }); addMsg('system', `Error: ${err.message}`); }
  } finally {
    // Fix orphaned tool_use blocks: if assistant message has tool_use
    // without matching tool_results, append stubs so the API won't reject next request.
    // Case 1: last msg is assistant with tool_use → no results at all
    // Case 2: last msg is user with partial tool_results → some tools missing results
    const len = conversation.length;
    let asstMsg = null, existingResultIds = new Set();
    if (len >= 1 && conversation[len - 1]?.role === 'assistant') {
      asstMsg = conversation[len - 1];
    } else if (len >= 2 && conversation[len - 2]?.role === 'assistant' && conversation[len - 1]?.role === 'user') {
      asstMsg = conversation[len - 2];
      const userMsg = conversation[len - 1];
      if (Array.isArray(userMsg.content)) {
        for (const b of userMsg.content) {
          if (b.type === 'tool_result') existingResultIds.add(b.tool_use_id);
        }
      }
    }
    if (asstMsg && Array.isArray(asstMsg.content)) {
      const missingIds = asstMsg.content
        .filter(b => b.type === 'tool_use' && !existingResultIds.has(b.id))
        .map(b => b.id);
      if (missingIds.length > 0) {
        const stubs = missingIds.map(id => ({
          type: 'tool_result', tool_use_id: id, is_error: true,
          content: [{ type: 'text', text: 'Aborted by user' }],
        }));
        if (existingResultIds.size > 0) {
          // Merge into existing user message
          conversation[len - 1].content.push(...stubs);
        } else {
          conversation.push({ role: 'user', content: stubs });
        }
      }
    }
    finalizeToolGroup(activeToolGroup);
    endToolGroup();
    await releaseDebugger();
    setRunning(false); setStatus(''); inputEl.focus();
    saveCurrentState();
  }
}

// ── Hook Message Handlers ──

async function handleHookMessage(msg) {
  // Stop task command
  if (msg.type === 'hook_stop') {
    if (abortController) abortController.abort();
    sendHookResponse(msg.taskId, 'stopped', 'Task stopped by hook');
    return;
  }

  if (msg.type !== 'hook_task') return;

  const taskId = msg.taskId || ('task_' + Date.now());
  activeHookTaskId = taskId;
  const taskPreview = (msg.task || '').slice(0, 40) || taskId;
  hookLogAdd('run', `Task received: ${taskPreview}`);
  updateHookStatus(hookConnected, true);

  // Busy check
  if (isRunning) {
    sendHookResponse(taskId, 'error', 'Agent is busy with another task');
    hookLogAdd('err', 'Rejected: agent busy');
    hookStats.error++;
    activeHookTaskId = null;
    updateHookStatus(hookConnected, false);
    return;
  }

  // Lock target tab if specified
  if (msg.tabId) {
    lockedTabId = msg.tabId;
  }

  // Switch or create conversation
  if (msg.conversationId && allConversations[msg.conversationId]) {
    switchConversation(msg.conversationId);
    // Update the existing conversation's tab association if hook re-pinned it
    if (msg.tabId && allConversations[msg.conversationId]) {
      allConversations[msg.conversationId].tabId = msg.tabId;
    }
  } else if (msg.action !== 'continue_task') {
    if (activeConvId && conversation.length > 0) saveCurrentState();
    createConversation(msg.tabId);
    conversation = [];
    messagesEl.innerHTML = '';
    renderConversationList();
  }

  // Per-task override of API config (apiUrl / apiKey / model). NOT persisted to
  // localStorage — restored in finally so the sidepanel UI stays untouched.
  const _savedApiUrl = API_URL;
  const _savedApiKey = API_KEY;
  const _savedModelValue = modelSelect.value;
  if (msg.apiUrl) API_URL = msg.apiUrl;
  if (typeof msg.apiKey === 'string') API_KEY = msg.apiKey;
  if (msg.model) modelSelect.value = msg.model;

  // Collapse previous groups
  messagesEl.querySelectorAll('.tool-group:not(.collapsed)').forEach(g => {
    g.classList.add('collapsed');
    const arrow = g.querySelector('.tool-group-arrow');
    if (arrow) arrow.textContent = '\u203A';
  });

  // Inject task as user message
  const text = msg.task;
  addMsg('user', text);
  conversation.push({ role: 'user', content: text });

  // Record conversation length before this task (to extract only new messages)
  const convLenBefore = conversation.length;

  // Send "started" response
  sendHookResponse(taskId, 'started', null);

  // Run agent loop — try/finally restores per-task API overrides
  try {
    await runAgentLoop();
  } finally {
    API_URL = _savedApiUrl;
    API_KEY = _savedApiKey;
    modelSelect.value = _savedModelValue;
  }

  // Build completed response with optional extra data
  const newMessages = conversation.slice(convLenBefore);

  // Extract last assistant text
  let resultText = 'Task completed';
  for (let i = newMessages.length - 1; i >= 0; i--) {
    const m = newMessages[i];
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const textBlock = [...m.content].reverse().find(b => b.type === 'text');
      if (textBlock?.text) { resultText = textBlock.text; break; }
    } else if (m.role === 'assistant' && typeof m.content === 'string') {
      resultText = m.content; break;
    }
  }

  const extra = {};

  // include_screenshot: return last screenshot as base64
  if (msg.include_screenshot) {
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const m = newMessages[i];
      if (m.role !== 'user' || !Array.isArray(m.content)) continue;
      for (let j = m.content.length - 1; j >= 0; j--) {
        const block = m.content[j];
        // tool_result with image
        if (block.type === 'tool_result' && Array.isArray(block.content)) {
          const img = block.content.find(b => b.type === 'image');
          if (img?.source?.data) {
            extra.screenshot = { data: img.source.data, media_type: img.source.media_type || 'image/png' };
            break;
          }
        }
      }
      if (extra.screenshot) break;
    }
  }

  // include_tools: return structured tool call/result log
  if (msg.include_tools) {
    const tools = [];
    for (const m of newMessages) {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === 'tool_use') tools.push({ type: 'call', name: b.name, input: b.input });
        }
      }
      if (m.role === 'user' && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === 'tool_result') {
            const texts = b.content?.filter(c => c.type === 'text').map(c => c.text) || [];
            const hasImage = b.content?.some(c => c.type === 'image') || false;
            tools.push({ type: 'result', tool_use_id: b.tool_use_id, is_error: b.is_error || false, texts, hasImage });
          }
        }
      }
    }
    extra.tools = tools;
  }

  sendHookResponse(taskId, 'completed', resultText, extra);
  hookLogAdd('ok', `Task completed: ${(resultText || '').slice(0, 40) || taskId}`);
  hookStats.done++;
  activeHookTaskId = null;
  updateHookStatus(hookConnected, false);
}

function sendHookResponse(taskId, status, result, extra) {
  if (!swPort) return;
  try {
    swPort.postMessage({
      type: 'hook_response',
      taskId,
      status,
      result,
      conversationId: activeConvId,
      tabId: lockedTabId,
      ...extra,
    });
  } catch {}
}

// Migrate old messages that lack .msg-header (add sender + time)
function migrateOldMessages(container) {
  container.querySelectorAll('.msg').forEach(msg => {
    if (msg.querySelector('.msg-header')) return; // already has header
    let role = 'system';
    if (msg.classList.contains('user')) role = 'user';
    else if (msg.classList.contains('ai')) role = 'ai';
    else if (msg.classList.contains('thinking')) role = 'ai';
    const header = document.createElement('div');
    header.className = 'msg-header';
    const sender = document.createElement('span');
    sender.className = 'msg-sender';
    sender.textContent = role === 'user' ? 'You' : role === 'ai' ? 'AI' : 'System';
    const time = document.createElement('span');
    time.className = 'msg-time';
    // Try to get timestamp from conversation data, fallback to empty
    time.textContent = '';
    header.appendChild(sender);
    header.appendChild(time);
    msg.insertBefore(header, msg.firstChild);
  });
}

// ── Init ──
loadConversations().then(() => {
  if (activeConvId && allConversations[activeConvId]) {
    const conv = allConversations[activeConvId];
    conversation = conv.messages || [];
    messagesEl.innerHTML = sanitizeHtml(conv.displayMessages || '');
    migrateOldMessages(messagesEl);
    // Finalize any uncollapsed groups restored from storage
    messagesEl.querySelectorAll('.tool-group:not(.collapsed)').forEach(g => finalizeToolGroup(g));
    scrollBottom();
  } else { createConversation(); }
  renderConversationList();
});
setStatus('Ready');
setTimeout(() => setStatus(''), 1500);
