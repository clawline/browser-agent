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
        if (msg.connected && !hookConnected) hookLogAdd('info', 'Bridge connected');
        else if (!msg.connected && hookConnected) hookLogAdd('err', 'Bridge disconnected');
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
  const apiVal = document.getElementById('bp-api-val');
  const taskStats = document.getElementById('bp-task-stats');
  const logEl = document.getElementById('bp-log');
  if (!hookVal) return;

  hookVal.textContent = hookConnected ? 'Connected' : 'Disconnected';
  hookVal.className = 'bp-val ' + (hookConnected ? 'bp-on' : 'bp-off');

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

function createConversation() {
  const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  allConversations[id] = { id, title: 'New conversation', messages: [], displayMessages: [], updatedAt: Date.now() };
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
  conv.displayMessages = messagesEl.innerHTML.replace(/src="data:image\/[^"]+"/g, 'src=""');
  conv.updatedAt = Date.now();
  updateConvTitle(conv);
  saveConversations();
  renderConversationList();
}

function switchConversation(id) {
  if (activeConvId && allConversations[activeConvId]) {
    allConversations[activeConvId].messages = conversation;
    allConversations[activeConvId].displayMessages = messagesEl.innerHTML.replace(/src="data:image\/[^"]+"/g, 'src=""');
  }
  activeConvId = id;
  activeToolGroup = null; stepCount = 0; // Reset tool group state
  const conv = allConversations[id];
  conversation = conv?.messages || [];
  messagesEl.innerHTML = conv?.displayMessages || '';
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
    div.innerHTML = `<span class="conv-title">${escapeHtml(conv.title)}</span><span class="conv-time">${ago}</span><button class="conv-delete" data-id="${conv.id}" title="Delete">&times;</button>`;
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
if (savedModel) modelSelect.value = savedModel;
const savedSteps = localStorage.getItem('clawline-steps');
if (savedSteps) stepsSelect.value = savedSteps;
thinkingEnabled = localStorage.getItem('clawline-thinking') === 'true';
fastMode = localStorage.getItem('clawline-fast') === 'true';
if (thinkingEnabled) thinkingToggle.classList.add('active');
if (fastMode) fastToggle.classList.add('active');

// Restore API settings
const savedApiUrl = localStorage.getItem('clawline-api-url');
if (savedApiUrl) API_URL = savedApiUrl;
const savedApiKey = localStorage.getItem('clawline-api-key');
if (savedApiKey) API_KEY = savedApiKey;

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

document.getElementById('cfg-save').addEventListener('click', () => {
  API_URL = cfgApiUrl.value.trim() || 'http://127.0.0.1:4819';
  API_KEY = cfgApiKey.value.trim();
  localStorage.setItem('clawline-api-url', API_URL);
  localStorage.setItem('clawline-api-key', API_KEY);
  settingsPanel.style.display = 'none';
  setStatus('Settings saved'); setTimeout(() => setStatus(''), 1500);
});

document.getElementById('cfg-cancel').addEventListener('click', () => {
  settingsPanel.style.display = 'none';
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

function getModel() { return fastMode ? FAST_MODEL : modelSelect.value; }

// ── Tool Definitions (matches original extension) ──

const TOOLS = [
  { name: 'read_page', description: 'Get accessibility tree of page elements with ref_IDs. Use filter="interactive" for only buttons/links/inputs. Use ref_id to focus on a specific element subtree.', input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['interactive', 'all'], description: 'Filter: "interactive" for buttons/links/inputs only, "all" for all elements (default)' }, depth: { type: 'number', description: 'Max tree depth (default: 15)' }, ref_id: { type: 'string', description: 'Focus on a specific element by ref_ID' }, max_chars: { type: 'number', description: 'Max output chars (default: 15000)' } } } },
  { name: 'find', description: 'Find elements by natural language query. Returns up to 20 matching elements with ref_IDs. E.g. "search bar", "login button", "product title containing organic".', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Natural language description of what to find' } }, required: ['query'] } },
  { name: 'form_input', description: 'Set form element values by ref_ID. For checkboxes use boolean, for selects use option value/text, for inputs use string.', input_schema: { type: 'object', properties: { ref: { type: 'string', description: 'Element ref_ID from read_page (e.g. "ref_1")' }, value: { type: ['string', 'boolean', 'number'], description: 'Value to set' } }, required: ['ref', 'value'] } },
  { name: 'computer', description: 'Mouse, keyboard, and screenshot actions. Always take a screenshot first to see coordinates before clicking. Click element centers, not edges.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['left_click', 'right_click', 'type', 'screenshot', 'wait', 'scroll', 'key', 'left_click_drag', 'double_click', 'triple_click', 'zoom', 'scroll_to', 'hover'], description: 'Action to perform. zoom: capture a specific region for closer inspection. scroll_to: scroll element into view by ref.' }, coordinate: { type: 'array', items: { type: 'number' }, description: '[x, y] pixel coordinates. For drag, this is the end position.' }, text: { type: 'string', description: 'Text to type (for type action) or keys to press (for key action, e.g. "cmd+a", "Backspace")' }, duration: { type: 'number', description: 'Seconds to wait (for wait action, max 10)' }, scroll_direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' }, scroll_amount: { type: 'number', description: 'Scroll ticks (default 3)' }, start_coordinate: { type: 'array', items: { type: 'number' }, description: 'Start [x,y] for drag' }, region: { type: 'array', items: { type: 'number' }, description: '[x0, y0, x1, y1] rectangle to capture for zoom action' }, repeat: { type: 'number', description: 'Times to repeat key sequence (for key action, default 1)' }, ref: { type: 'string', description: 'Element ref_ID — alternative to coordinate for click/scroll_to' }, modifiers: { type: 'string', description: 'Modifier keys: "ctrl", "shift", "alt", "cmd". Combine with "+" (e.g. "ctrl+shift")' } }, required: ['action'] } },
  { name: 'navigate', description: 'Navigate to a URL, or use "back"/"forward" for browser history.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to, or "back"/"forward" for history' } }, required: ['url'] } },
  { name: 'get_page_text', description: 'Extract raw text content from the page. Ideal for reading articles, blog posts, or text-heavy pages. Returns plain text without HTML.', input_schema: { type: 'object', properties: { max_chars: { type: 'number', description: 'Max chars (default: 15000)' } } } },
  { name: 'tabs_create', description: 'Create a new empty browser tab.', input_schema: { type: 'object', properties: {} } },
  { name: 'tabs_context', description: 'Get list of all open browser tabs with their IDs, titles, and URLs.', input_schema: { type: 'object', properties: {} } },
  { name: 'read_console_messages', description: 'Read browser console messages (console.log/error/warn). Use pattern to filter. Useful for debugging.', input_schema: { type: 'object', properties: { onlyErrors: { type: 'boolean', description: 'Only return errors (default: false)' }, pattern: { type: 'string', description: 'Regex pattern to filter messages' }, limit: { type: 'number', description: 'Max messages (default: 100)' }, clear: { type: 'boolean', description: 'Clear after reading (default: false)' } } } },
  { name: 'read_network_requests', description: 'Read HTTP network requests (XHR, Fetch, etc). Useful for debugging API calls.', input_schema: { type: 'object', properties: { urlPattern: { type: 'string', description: 'URL pattern to filter (e.g. "/api/")' }, limit: { type: 'number', description: 'Max requests (default: 100)' }, clear: { type: 'boolean', description: 'Clear after reading (default: false)' } } } },
  { name: 'resize_window', description: 'Resize browser window to specific dimensions. Useful for responsive testing.', input_schema: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] } },
  { name: 'javascript_tool', description: 'Execute JavaScript in the page context. Returns result of last expression. Do NOT use "return" — just write the expression.', input_schema: { type: 'object', properties: { action: { type: 'string', description: 'Must be "javascript_exec"' }, text: { type: 'string', description: 'JavaScript code to execute' } }, required: ['action', 'text'] } },
  { name: 'file_upload', description: 'Upload files to a file input element. Do NOT click file inputs — use this tool with the ref_ID instead. Paths must be absolute.', input_schema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Absolute file paths to upload' }, ref: { type: 'string', description: 'ref_ID of the file input element' } }, required: ['paths', 'ref'] } },
  { name: 'update_plan', description: 'Present a plan to the user before proceeding with complex tasks.', input_schema: { type: 'object', properties: { domains: { type: 'array', items: { type: 'string' }, description: 'Domains to visit' }, approach: { type: 'array', items: { type: 'string' }, description: 'Ordered steps (3-7)' } }, required: ['domains', 'approach'] } },
  { name: 'turn_answer_start', description: 'Call this immediately before your text response to the user for this turn. Required every turn - whether or not you made tool calls. After calling, write your response. No more tools after this.', input_schema: { type: 'object', properties: {}, required: [] }, cache_control: { type: 'ephemeral' } },
];

// ── Skill Modes ──

const SKILL_MODES = {
  general: {
    label: 'General',
    instructions: `- Be concise. Focus on completing the task, not explaining your process.
- Handle errors gracefully — try alternatives when one approach fails.
- You may investigate issues using console, network, and JS tools when needed.
- Balance between completing the task efficiently and being thorough.
- For forms: read_page → identify fields → form_input by ref → click submit.`,
  },
  qa: {
    label: 'QA Test',
    instructions: `- You are a QA tester. ONLY execute steps and report results.
- Follow numbered steps EXACTLY in order. Do NOT skip, reorder, or add steps.
- If a step fails, record "FAIL — [what you see]" and move to the next step.
- NEVER debug or investigate on your own. Do NOT check network requests, console logs, or DOM internals unless the user explicitly asks you to.
- Do NOT retry a failed step more than once. Move on.
- Your job is to EXECUTE and REPORT, not to ANALYZE or FIX.
- Report format: PASS or FAIL with brief description.
- Limit yourself to the tools and actions the user's steps require. Do not use extra tools to "understand" the situation.`,
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

5. Use form_input to set values in input fields, selects, checkboxes — it's faster and more reliable than computer type.

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

<behavior_instructions>
The current date is ${new Date().toLocaleDateString()}.
Current mode: ${mode.label}.

${behaviorText}
</behavior_instructions>

<tool_workflows>
1. See page structure: read_page (filter="interactive" first, "all" only if needed)
2. Find specific elements: find("search button") → get ref_IDs
3. Click elements: computer left_click with ref="ref_1" (preferred) or coordinate=[x,y]
4. Fill forms: form_input with ref="ref_1" and value="text"
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
      const safe = /^https?:\/\//.test(url) ? url : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

  // Convert list items (keep consecutive items together)
  processed = processed.replace(/^- (.+)$/gm, '<li>$1</li>');
  processed = processed.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> into <ul>, handling newlines between them
  processed = processed.replace(/((?:<li>.*?<\/li>\s*)+)/g, (match) => {
    return '<ul>' + match.replace(/\s*(<li>)/g, '$1').replace(/(<\/li>)\s*/g, '$1') + '</ul>';
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

  return final;
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
    const labels = { read_page: `Read page${args?.filter === 'interactive' ? ' (interactive)' : ''}`, find: `Find "${(args?.query || '').slice(0, 25)}"`, form_input: `Set ${args?.ref}`, navigate: 'Navigate', get_page_text: 'Get page text', javascript_tool: 'JavaScript', tabs_create: 'Create tab', tabs_context: 'Tab context', read_console_messages: 'Console', read_network_requests: 'Network', resize_window: 'Resize', file_upload: 'Upload file', update_plan: 'Update plan' };
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

// Auto-clear debuggerTabId when browser detaches debugger (e.g. user opens DevTools)
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === debuggerTabId) debuggerTabId = null;
});

async function ensureDebugger(tabId) {
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
  return Promise.race([
    chrome.debugger.sendCommand({ tabId: debuggerTabId }, method, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000)),
  ]);
}

// ── Tool Execution ──

// Lock target tab at start of agent loop — survives user switching tabs
let lockedTabId = null;

async function getTargetTab() {
  if (lockedTabId) {
    try {
      const tab = await chrome.tabs.get(lockedTabId);
      if (tab && !tab.url?.startsWith('chrome://')) return lockedTabId;
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
}

async function executeTool(name, args) {
  // Global timeout: if any tool takes over 60s, abort with error
  return Promise.race([
    _executeTool(name, args),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool "${name}" timed out after 60s`)), 60000)),
  ]);
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
        await new Promise(r => setTimeout(r, (args.duration || 2) * 1000));
        return { content: [{ type: 'text', text: `Waited ${args.duration || 2}s` }] };
      }
      if (['left_click', 'right_click', 'double_click', 'triple_click'].includes(action)) {
        if (args.ref) {
          await injectContentScript(tabId);
          const results = await chrome.scripting.executeScript({ target: { tabId }, func: (refId, action) => {
            const map = window.__clawlineElementMap;
            if (!map?.[refId]) return { error: `Element ${refId} not found.` };
            const el = map[refId].deref();
            if (!el || !document.contains(el)) { delete map[refId]; return { error: `Element ${refId} no longer exists.` }; }
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
          return { content: [{ type: 'text', text: `Clicked ${args.ref} <${r?.tag}> "${r?.text}"` }] };
        }
        if (!args.coordinate) return { content: [{ type: 'text', text: 'Click requires either ref or coordinate parameter' }] };
        const [x, y] = scaleCoordinate(...args.coordinate);
        const count = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
        const button = action === 'right_click' ? 'right' : 'left';
        await ensureDebugger(tabId);
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count });
        return { content: [{ type: 'text', text: `Clicked [${x},${y}]` }] };
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
        for (let r = 0; r < repeat; r++) {
          for (const k of keys) {
            if (k.includes('+')) {
              // Key combo
              const parts = k.split('+');
              const modMap = { ctrl: 'Control', cmd: 'Meta', meta: 'Meta', alt: 'Alt', shift: 'Shift' };
              const codeMap = { a: 65, c: 67, v: 86, x: 88, z: 90 };
              const mods = parts.slice(0, -1);
              const main = parts[parts.length - 1];
              let modBits = 0;
              for (const m of mods) { if (m === 'alt') modBits |= 1; if (m === 'ctrl') modBits |= 2; if (m === 'meta' || m === 'cmd') modBits |= 4; if (m === 'shift') modBits |= 8; }
              for (const m of mods) await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: modMap[m] || m, modifiers: modBits });
              const vk = codeMap[main] || main.toUpperCase().charCodeAt(0);
              await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: main, windowsVirtualKeyCode: vk, modifiers: modBits });
              await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: main, windowsVirtualKeyCode: vk, modifiers: modBits });
              for (const m of mods.reverse()) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: modMap[m] || m });
            } else {
              const map = { Enter: 13, Return: 13, Tab: 9, Escape: 27, Backspace: 8, Space: 32, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
              const code = map[k] || k.charCodeAt(0);
              await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, windowsVirtualKeyCode: code });
              await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code });
            }
          }
        }
        return { content: [{ type: 'text', text: `Key: ${args.text}${(args.repeat || 1) > 1 ? ` x${args.repeat}` : ''}` }] };
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
            const el = window.__clawlineElementMap?.[refId]?.deref();
            if (!el) return { error: `Element ${refId} not found` };
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
          const el = window.__clawlineElementMap?.[refId]?.deref();
          if (!el) return { error: `Element ${refId} not found` };
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
        const map = window.__clawlineElementMap;
        if (!map?.[ref]) return { error: `Element ${ref} not found.` };
        const el = map[ref].deref();
        if (!el || !document.contains(el)) { delete map[ref]; return { error: `Element ${ref} no longer exists.` }; }
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();
        const tag = el.tagName.toLowerCase();
        if (tag === 'select') {
          const opts = Array.from(el.options);
          const opt = opts.find(o => o.value === String(value) || o.text.trim() === String(value));
          if (opt) { el.value = opt.value; } else { el.value = String(value); }
        } else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
          el.checked = !!value;
        } else if ('value' in el) {
          el.value = String(value);
          el.setSelectionRange?.(el.value.length, el.value.length);
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

    case 'navigate': {
      const url = args.url;
      if (url === 'back') await chrome.tabs.goBack(tabId);
      else if (url === 'forward') await chrome.tabs.goForward(tabId);
      else await chrome.tabs.update(tabId, { url: url.startsWith('http') ? url : 'https://' + url });
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try { const r = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.readyState }); if (r?.[0]?.result === 'complete') break; } catch {}
      }
      const tab = await chrome.tabs.get(tabId);
      return { content: [{ type: 'text', text: `Navigated to: ${tab.url}` }] };
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
      // Use CDP Network domain to capture all requests (including those before injection)
      if (!window.__clawlineNetworkEnabled) {
        window.__clawlineNetworkRequests = [];
        await cdp('Network.enable');
        // Remove previous listener if any, then store new one
        if (_debuggerEventListener) {
          chrome.debugger.onEvent.removeListener(_debuggerEventListener);
        }
        _debuggerEventListener = (source, method, params) => {
          if (source.tabId !== debuggerTabId) return;
          if (method === 'Network.responseReceived') {
            const r = params.response;
            window.__clawlineNetworkRequests.push({
              url: r.url,
              method: params.type === 'XHR' || params.type === 'Fetch' ? 'GET' : params.type,
              status: r.status,
              mimeType: r.mimeType,
              ts: Date.now(),
            });
            if (window.__clawlineNetworkRequests.length > 500) window.__clawlineNetworkRequests.shift();
          }
          if (method === 'Network.requestWillBeSent') {
            // Update method for the URL
            const existing = window.__clawlineNetworkRequests?.find(r => r.url === params.request.url && r.method === params.type);
            if (existing) existing.method = params.request.method;
            else {
              window.__clawlineNetworkRequests.push({
                url: params.request.url,
                method: params.request.method,
                status: 0,
                ts: Date.now(),
              });
              if (window.__clawlineNetworkRequests.length > 500) window.__clawlineNetworkRequests.shift();
            }
          }
        };
        chrome.debugger.onEvent.addListener(_debuggerEventListener);
        window.__clawlineNetworkEnabled = true;
      }
      // Also try the injected approach as fallback for requests made before CDP was enabled
      let reqs = window.__clawlineNetworkRequests || [];
      // Merge with content-script captured requests
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId }, func: (urlPattern, limit) => {
          if (!window.__clawlineNetReqs) {
            window.__clawlineNetReqs = [];
            const origFetch = window.fetch;
            window.fetch = async function(...args) {
              const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
              const method = args[1]?.method || 'GET';
              const start = Date.now();
              try {
                const res = await origFetch.apply(this, args);
                window.__clawlineNetReqs.push({ url, method, status: res.status, duration: Date.now() - start, ts: start });
                if (window.__clawlineNetReqs.length > 500) window.__clawlineNetReqs.shift();
                return res;
              } catch (e) {
                window.__clawlineNetReqs.push({ url, method, status: 0, error: e.message, duration: Date.now() - start, ts: start });
                throw e;
              }
            };
          }
          let r = window.__clawlineNetReqs || [];
          if (urlPattern) r = r.filter(x => x.url.includes(urlPattern));
          return r.slice(-(limit || 100));
        }, args: [args.urlPattern || null, args.limit || 100] });
        const csReqs = results?.[0]?.result || [];
        // Merge: add CS requests not already in CDP list
        const cdpUrls = new Set(reqs.map(r => r.url));
        for (const r of csReqs) { if (!cdpUrls.has(r.url)) reqs.push(r); }
      } catch {}

      if (args.urlPattern) reqs = reqs.filter(r => r.url.includes(args.urlPattern));
      reqs = reqs.slice(-(args.limit || 100));
      if (args.clear) { window.__clawlineNetworkRequests = []; }
      if (reqs.length === 0) return { content: [{ type: 'text', text: 'No network requests captured. Note: requests made before monitoring started cannot be captured.' }] };
      const lines = reqs.map(r => `${r.method || '?'} ${r.status} ${r.url?.slice(0, 120)}${r.duration ? ` (${r.duration}ms)` : ''}`).join('\n');
      return { content: [{ type: 'text', text: `${reqs.length} requests:\n${lines}` }] };
    }

    case 'resize_window': {
      const win = await chrome.windows.getCurrent();
      await chrome.windows.update(win.id, { width: args.width, height: args.height });
      return { content: [{ type: 'text', text: `Resized to ${args.width}x${args.height}` }] };
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
        const el = window.__clawlineElementMap?.[refId]?.deref();
        if (!el) return { error: `Element ${refId} not found` };
        // Tag element for CDP lookup
        const attr = '__clawline_file_' + Date.now();
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

      const res = await fetchWithRetry(`${API_URL}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(API_KEY ? { 'x-api-key': API_KEY } : { 'Authorization': 'Bearer dev-local-token' }) },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) { addMsg('system', `API Error ${res.status}: ${await res.text()}`); break; }

      const blocks = [];
      let textDiv = null, textBuf = '', toolBuf = null, stopReason = null;

      for await (const evt of parseSSE(res)) {
        if (abortController.signal.aborted) break;
        switch (evt.type) {
          case 'content_block_start':
            if (evt.content_block?.type === 'text') { textDiv = addTextStep(); textBuf = ''; }
            else if (evt.content_block?.type === 'tool_use') { toolBuf = { id: evt.content_block.id, name: evt.content_block.name, input: '' }; }
            else if (evt.content_block?.type === 'thinking') { textDiv = addThinking(''); textBuf = ''; setStatus('Thinking...'); }
            break;
          case 'content_block_delta':
            if (evt.delta?.type === 'text_delta') { textBuf += evt.delta.text; if (textDiv) textDiv.innerHTML = renderMarkdown(textBuf); scrollBottom(); }
            else if (evt.delta?.type === 'input_json_delta' && toolBuf) { toolBuf.input += evt.delta.partial_json; }
            else if (evt.delta?.type === 'thinking_delta') { textBuf += evt.delta.thinking; if (textDiv) textDiv.textContent = textBuf; scrollBottom(); }
            break;
          case 'content_block_stop':
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

      if (abortController.signal.aborted) break;
      if (blocks.length > 0) conversation.push({ role: 'assistant', content: blocks });

      const toolUses = blocks.filter(b => b.type === 'tool_use');
      if (toolUses.length === 0) break;

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
    if (err.name !== 'AbortError') addMsg('system', `Error: ${err.message}`);
  } finally {
    // Fix orphaned tool_use blocks: if the last assistant message has tool_use
    // without a matching tool_result (e.g. due to abort or error), append stub results
    // so the API won't reject the next request.
    const lastMsg = conversation[conversation.length - 1];
    if (lastMsg?.role === 'assistant' && Array.isArray(lastMsg.content)) {
      const orphanedTools = lastMsg.content.filter(b => b.type === 'tool_use');
      if (orphanedTools.length > 0) {
        const stubResults = orphanedTools.map(t => ({
          type: 'tool_result',
          tool_use_id: t.id,
          is_error: true,
          content: [{ type: 'text', text: 'Aborted by user' }],
        }));
        conversation.push({ role: 'user', content: stubResults });
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
  } else if (msg.action !== 'continue_task') {
    if (activeConvId && conversation.length > 0) saveCurrentState();
    createConversation();
    conversation = [];
    messagesEl.innerHTML = '';
    renderConversationList();
  }

  // Override model if specified
  if (msg.model) {
    modelSelect.value = msg.model;
  }

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

  // Run agent loop
  await runAgentLoop();

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
    messagesEl.innerHTML = conv.displayMessages || '';
    migrateOldMessages(messagesEl);
    // Finalize any uncollapsed groups restored from storage
    messagesEl.querySelectorAll('.tool-group:not(.collapsed)').forEach(g => finalizeToolGroup(g));
    scrollBottom();
  } else { createConversation(); }
  renderConversationList();
});
setStatus('Ready');
setTimeout(() => setStatus(''), 1500);
