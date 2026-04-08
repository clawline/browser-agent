/* Claude (Dev Local) — Full browser agent sidepanel */

const API_URL = 'http://127.0.0.1:4819';
const MAX_TOKENS = 16384;
const MAX_LOOPS = 50;
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const THINKING_BUDGET = 10000;

// ── Conversation Storage ──

let allConversations = {}; // { id: { id, title, messages, updatedAt, displayMessages } }
let activeConvId = null;

async function loadConversations() {
  return new Promise(resolve => {
    chrome.storage.local.get(['conversations', 'activeConvId'], (data) => {
      allConversations = data.conversations || {};
      activeConvId = data.activeConvId || null;
      resolve();
    });
  });
}

function saveConversations() {
  // Strip base64 images from messages before saving to stay under storage limits
  const stripped = {};
  for (const [id, conv] of Object.entries(allConversations)) {
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
  chrome.storage.local.set({ conversations: stripped, activeConvId });
}

function createConversation() {
  const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  allConversations[id] = { id, title: 'New conversation', messages: [], displayMessages: [], updatedAt: Date.now() };
  activeConvId = id;
  saveConversations();
  return id;
}

function getActiveConv() {
  if (!activeConvId || !allConversations[activeConvId]) {
    createConversation();
  }
  return allConversations[activeConvId];
}

function updateConvTitle(conv) {
  // Use first user message as title
  const firstUser = conv.messages.find(m => m.role === 'user');
  if (firstUser) {
    const text = typeof firstUser.content === 'string' ? firstUser.content : firstUser.content?.find(b => b.type === 'text')?.text || '';
    conv.title = text.slice(0, 60) || 'New conversation';
  }
}

function saveCurrentState() {
  const conv = getActiveConv();
  conv.messages = conversation;
  // Strip base64 images from display HTML to fit in storage
  conv.displayMessages = messagesEl.innerHTML.replace(/src="data:image\/[^"]+"/g, 'src=""');
  conv.updatedAt = Date.now();
  updateConvTitle(conv);
  saveConversations();
  renderConversationList();
}

function switchConversation(id) {
  // Save current first
  if (activeConvId && allConversations[activeConvId]) {
    allConversations[activeConvId].messages = conversation;
    allConversations[activeConvId].displayMessages = messagesEl.innerHTML.replace(/src="data:image\/[^"]+"/g, 'src=""');
    allConversations[activeConvId].updatedAt = Date.now();
  }
  activeConvId = id;
  const conv = allConversations[id];
  conversation = conv?.messages || [];
  messagesEl.innerHTML = conv?.displayMessages || '';
  scrollBottom();
  saveConversations();
  renderConversationList();
}

function deleteConversation(id) {
  delete allConversations[id];
  if (activeConvId === id) {
    const ids = Object.keys(allConversations).sort((a, b) => (allConversations[b].updatedAt || 0) - (allConversations[a].updatedAt || 0));
    if (ids.length > 0) {
      switchConversation(ids[0]);
    } else {
      createConversation();
      conversation = [];
      messagesEl.innerHTML = '';
    }
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
      if (e.target.classList.contains('conv-delete')) {
        e.stopPropagation();
        deleteConversation(e.target.dataset.id);
        return;
      }
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

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// Restore settings
const savedModel = localStorage.getItem('claude-dev-model');
if (savedModel) modelSelect.value = savedModel;
thinkingEnabled = localStorage.getItem('claude-dev-thinking') === 'true';
fastMode = localStorage.getItem('claude-dev-fast') === 'true';
if (thinkingEnabled) thinkingToggle.classList.add('active');
if (fastMode) fastToggle.classList.add('active');

modelSelect.addEventListener('change', () => localStorage.setItem('claude-dev-model', modelSelect.value));

thinkingToggle.addEventListener('click', () => {
  thinkingEnabled = !thinkingEnabled;
  thinkingToggle.classList.toggle('active', thinkingEnabled);
  localStorage.setItem('claude-dev-thinking', thinkingEnabled);
  if (thinkingEnabled && fastMode) { fastMode = false; fastToggle.classList.remove('active'); localStorage.setItem('claude-dev-fast', false); }
  setStatus(thinkingEnabled ? 'Extended thinking ON' : 'Extended thinking OFF');
  setTimeout(() => setStatus(''), 1500);
});

fastToggle.addEventListener('click', () => {
  fastMode = !fastMode;
  fastToggle.classList.toggle('active', fastMode);
  localStorage.setItem('claude-dev-fast', fastMode);
  if (fastMode && thinkingEnabled) { thinkingEnabled = false; thinkingToggle.classList.remove('active'); localStorage.setItem('claude-dev-thinking', false); }
  setStatus(fastMode ? `Fast mode ON (${FAST_MODEL})` : 'Fast mode OFF');
  setTimeout(() => setStatus(''), 1500);
});

// Sidebar toggle
document.getElementById('history-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
document.getElementById('sidebar-close').addEventListener('click', () => sidebar.classList.remove('open'));

function getModel() {
  return fastMode ? FAST_MODEL : modelSelect.value;
}

// ── Tool Definitions ──

const TOOLS = [
  { name: 'screenshot', description: 'Take a screenshot of the current browser tab.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'click', description: 'Click an element. Provide EITHER ref_id (from read_page) OR coordinate [x,y] from screenshot. ref_id is preferred — it auto-scrolls and clicks the element center.', input_schema: { type: 'object', properties: { ref_id: { type: 'string', description: 'Element reference ID from accessibility tree (e.g. "ref_42"). Preferred over coordinates.' }, coordinate: { type: 'array', items: { type: 'number' }, description: '[x, y] pixels from screenshot. Used when ref_id not available.' }, action: { type: 'string', enum: ['left_click','right_click','double_click','triple_click','left_click_drag'], default: 'left_click' }, startCoordinate: { type: 'array', items: { type: 'number' } } } } },
  { name: 'type', description: 'Type text or press keys. Provide EITHER ref_id to target a specific input field, OR coordinate to click first. Using ref_id is faster — it focuses the field, sets value, and dispatches events.', input_schema: { type: 'object', properties: { ref_id: { type: 'string', description: 'Element reference ID for the input field (e.g. "ref_42"). Preferred.' }, text: { type: 'string' }, key: { type: 'string', description: 'Enter, Tab, Escape, Backspace, Space, etc.' }, coordinate: { type: 'array', items: { type: 'number' }, description: 'Click here first, then type. Used when ref_id not available.' }, clear: { type: 'boolean', description: 'Clear existing value before typing (default false)', default: false } } } },
  { name: 'navigate', description: 'Navigate the browser.', input_schema: { type: 'object', properties: { url: { type: 'string' }, action: { type: 'string', enum: ['goto','back','forward','refresh'], default: 'goto' } } } },
  { name: 'read_page', description: 'Read page content as an accessibility tree with ref_IDs for each element. Use ref_id parameter to focus on a specific element subtree.', input_schema: { type: 'object', properties: { ref_id: { type: 'string', description: 'Focus on a specific element by its ref_ID (e.g. "ref_42"). Omit to read the full page.' }, depth: { type: 'number', description: 'Max tree depth (default 15). Use smaller values for large pages.', default: 15 }, max_chars: { type: 'number', description: 'Max output characters (default 30000)', default: 30000 } } } },
  { name: 'scroll', description: 'Scroll the page.', input_schema: { type: 'object', properties: { direction: { type: 'string', enum: ['up','down','left','right'] }, amount: { type: 'number', default: 500 }, coordinate: { type: 'array', items: { type: 'number' } } }, required: ['direction'] } },
  { name: 'hover', description: 'Hover at coordinates.', input_schema: { type: 'object', properties: { coordinate: { type: 'array', items: { type: 'number' } } }, required: ['coordinate'] } },
  { name: 'evaluate', description: 'Execute JavaScript in the browser console. Returns the result as string.', input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'wait', description: 'Wait for a duration in ms.', input_schema: { type: 'object', properties: { duration: { type: 'number', default: 2000 } } } },
  { name: 'zoom', description: 'Change page zoom.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['in','out','reset'] } }, required: ['action'] } },
  { name: 'drag', description: 'Drag from start to end coordinates.', input_schema: { type: 'object', properties: { start_coordinate: { type: 'array', items: { type: 'number' }, description: '[x,y] start' }, coordinate: { type: 'array', items: { type: 'number' }, description: '[x,y] end' } }, required: ['start_coordinate', 'coordinate'] } },
  { name: 'key_combo', description: 'Press keyboard shortcut (e.g. "ctrl+a", "cmd+c", "ctrl+shift+k").', input_schema: { type: 'object', properties: { keys: { type: 'string', description: 'Key combo like "ctrl+a", "cmd+v", "ctrl+shift+k"' } }, required: ['keys'] } },
  { name: 'page_info', description: 'Get current page URL, title, viewport size, DOM stats. Use this to understand what page you are on.', input_schema: { type: 'object', properties: {} } },
];

const SYSTEM_PROMPT = `You are Claude, an AI assistant controlling the user's Chrome browser via a side panel.

Available tools: screenshot, click, type, navigate, read_page, scroll, hover, evaluate, wait, zoom, drag, key_combo, page_info.

IMPORTANT — Efficient element interaction workflow:
1. Use page_info to see what page you're on (URL, title, viewport)
2. Use read_page to get the accessibility tree with ref_IDs (e.g. [ref_42])
3. Use ref_id parameter in click/type tools — this is MUCH faster and more accurate than coordinates
4. Only use screenshot + coordinates as a fallback when ref_id doesn't work

Element interaction best practices:
- PREFER ref_id over coordinates: click({ref_id: "ref_42"}) auto-scrolls and clicks the element center
- type({ref_id: "ref_42", text: "hello"}) sets value directly — instant, no character-by-character typing
- Use clear: true to replace existing text in input fields
- Use key_combo for shortcuts: key_combo({keys: "ctrl+a"}) to select all, key_combo({keys: "cmd+c"}) to copy
- Use drag for drag-and-drop operations with start and end coordinates
- Use read_page with ref_id to inspect a specific element's subtree: read_page({ref_id: "ref_42"})

Navigation:
- After navigate, the tool automatically waits for page load and reports the final URL
- After click/type, the tool reports whether the page changed visually
- If the tool says "(page changed)", use read_page to see the new state instead of taking a screenshot
- If the tool says "(page unchanged)", no need to verify — proceed to next action
- Only use screenshot when you need to see visual layout that the accessibility tree can't capture

Guidelines:
- Always explain what you're doing
- Use read_page first, screenshot only when visual verification is needed
- Handle errors gracefully — if ref_id fails, fall back to coordinates
- For forms: read_page → identify fields by ref_id → type with ref_id → click submit with ref_id`;

// ── UI Helpers ──

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.addEventListener('click', sendMessage);
stopBtn.addEventListener('click', stopAgent);
document.getElementById('new-chat').addEventListener('click', () => {
  // Save current conversation before creating new
  if (activeConvId && conversation.length > 0) saveCurrentState();
  createConversation();
  conversation = [];
  messagesEl.innerHTML = '';
  pendingImages = [];
  attachmentsEl.innerHTML = '';
  renderConversationList();
});

// File upload
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
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
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
function setRunning(r) {
  isRunning = r;
  sendBtn.disabled = r;
  stopBtn.style.display = r ? 'flex' : 'none';
  inputEl.disabled = r;
}

function stopAgent() {
  abortController?.abort();
  abortController = null;
  setRunning(false);
  setStatus('Stopped');
  setTimeout(() => setStatus(''), 1500);
}

// ── Markdown Renderer (simple) ──

function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Unordered list
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Line breaks (double newline = paragraph)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap loose <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');
  return '<p>' + html + '</p>';
}

// ── Message Display ──

function addMsg(role, content, cls) {
  const div = document.createElement('div');
  div.className = `msg ${cls || role}`;
  if (role === 'ai' && typeof content === 'string') {
    div.innerHTML = renderMarkdown(content);
    // Copy button
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '📋';
    btn.onclick = () => { navigator.clipboard.writeText(content); btn.textContent = '✓'; setTimeout(() => btn.textContent = '📋', 1000); };
    div.appendChild(btn);
  } else if (typeof content === 'string') {
    div.textContent = content;
  } else {
    div.appendChild(content);
  }
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function addThinking(text) {
  const div = document.createElement('div');
  div.className = 'msg thinking';
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollBottom();
  return div;
}

function addScreenshot(base64, mediaType) {
  const container = document.createElement('div');
  const img = document.createElement('img');
  img.src = `data:${mediaType || 'image/png'};base64,${base64}`;
  img.className = 'screenshot';
  img.onclick = () => img.classList.toggle('expanded');
  container.appendChild(img);
  // Append screenshot to active tool group if exists
  const group = messagesEl.querySelector('.tool-group:last-child');
  if (group) {
    group.querySelector('.tool-group-body').appendChild(container);
    return container;
  }
  return addMsg('tool', container, 'tool');
}

// Tool group: collapsible container for consecutive tool calls + results
let activeToolGroup = null;

function ensureToolGroup() {
  // Reuse active group if last child is a tool group
  const last = messagesEl.lastElementChild;
  if (last?.classList.contains('tool-group')) {
    activeToolGroup = last;
    return activeToolGroup;
  }
  // Create new group
  const group = document.createElement('div');
  group.className = 'msg tool-group';
  const header = document.createElement('div');
  header.className = 'tool-group-header';
  header.innerHTML = '<span class="tool-group-arrow">▶</span> <span class="tool-group-label">Tools</span>';
  header.onclick = () => {
    group.classList.toggle('open');
    header.querySelector('.tool-group-arrow').textContent = group.classList.contains('open') ? '▼' : '▶';
  };
  const body = document.createElement('div');
  body.className = 'tool-group-body';
  group.appendChild(header);
  group.appendChild(body);
  messagesEl.appendChild(group);
  activeToolGroup = group;
  scrollBottom();
  return group;
}

function addToolCall(name, args) {
  const group = ensureToolGroup();
  const body = group.querySelector('.tool-group-body');
  const tag = document.createElement('span');
  tag.className = 'tool-tag';
  tag.textContent = `🔧 ${name}`;
  if (args && Object.keys(args).length > 0) {
    tag.title = JSON.stringify(args, null, 2);
  }
  body.appendChild(tag);
  // Update header label with tool names
  const tags = body.querySelectorAll('.tool-tag');
  const names = [...tags].map(t => t.textContent.replace('🔧 ', '')).join(' → ');
  group.querySelector('.tool-group-label').textContent = names;
  scrollBottom();
}

function addToolResult(text) {
  const group = activeToolGroup || ensureToolGroup();
  const body = group.querySelector('.tool-group-body');
  const div = document.createElement('div');
  div.className = 'tool-result-text';
  div.textContent = text;
  body.appendChild(div);
}

function endToolGroup() {
  activeToolGroup = null;
}

// ── Screenshot Optimization (matches original extension) ──

const SCREENSHOT_PX_PER_TOKEN = 28;
const SCREENSHOT_MAX_TARGET_PX = 1568;
const SCREENSHOT_MAX_TARGET_TOKENS = 1568;
const SCREENSHOT_INITIAL_QUALITY = 75;
const SCREENSHOT_MIN_QUALITY = 10;
const SCREENSHOT_QUALITY_STEP = 5;
const SCREENSHOT_MAX_BASE64 = 1398100; // ~1.35MB

// Binary search for optimal screenshot dimensions within token budget
function calcScreenshotDimensions(w, h) {
  const pxTokens = (sw, sh) => Math.ceil(sw / SCREENSHOT_PX_PER_TOKEN) * Math.ceil(sh / SCREENSHOT_PX_PER_TOKEN);
  if (w <= SCREENSHOT_MAX_TARGET_PX && h <= SCREENSHOT_MAX_TARGET_PX && pxTokens(w, h) <= SCREENSHOT_MAX_TARGET_TOKENS) {
    return [w, h];
  }
  // Ensure w >= h for consistent binary search
  const swapped = h > w;
  if (swapped) [w, h] = [h, w];
  const ratio = w / h;
  let lo = 1, hi = w;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const sh = Math.max(Math.round(mid / ratio), 1);
    if (mid <= SCREENSHOT_MAX_TARGET_PX && pxTokens(mid, sh) <= SCREENSHOT_MAX_TARGET_TOKENS) lo = mid;
    else hi = mid;
  }
  const rh = Math.max(Math.round(lo / ratio), 1);
  return swapped ? [rh, lo] : [lo, rh];
}

// Viewport dimensions tracker for coordinate mapping
let lastViewport = { vw: 0, vh: 0, sw: 0, sh: 0 };

async function captureScreenshotOptimized(tabId) {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    const layoutMetrics = await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics');
    const vw = layoutMetrics.cssVisualViewport?.clientWidth || layoutMetrics.visualViewport?.clientWidth || 1280;
    const vh = layoutMetrics.cssVisualViewport?.clientHeight || layoutMetrics.visualViewport?.clientHeight || 720;
    const [sw, sh] = calcScreenshotDimensions(vw, vh);
    const scale = sw < vw ? sw / vw : 1;

    // Adaptive quality: start at 75%, reduce by 5% until under size limit
    let quality = SCREENSHOT_INITIAL_QUALITY;
    let result;
    while (quality >= SCREENSHOT_MIN_QUALITY) {
      result = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality,
        captureBeyondViewport: false,
        fromSurface: true,
        clip: { x: 0, y: 0, width: vw, height: vh, scale },
      });
      if (result.data.length <= SCREENSHOT_MAX_BASE64) break;
      quality -= SCREENSHOT_QUALITY_STEP;
    }

    lastViewport = { vw, vh, sw, sh };
    return {
      base64: result.data,
      mediaType: 'image/jpeg',
      dimensions: `${sw}x${sh} (q${quality}, ${Math.round(result.data.length/1024)}KB)`,
    };
  } finally {
    try { await chrome.debugger.detach({ tabId }); } catch {}
  }
}

// Scale coordinates from screenshot space back to viewport space
function scaleCoordinate(x, y) {
  if (lastViewport.sw && lastViewport.vw && lastViewport.sw !== lastViewport.vw) {
    const sx = lastViewport.vw / lastViewport.sw;
    const sy = lastViewport.vh / lastViewport.sh;
    return [Math.round(x * sx), Math.round(y * sy)];
  }
  return [x, y];
}

// ── Screencast: lightweight page-change detection ──
// Low-res video feed (100x100, q10) to detect page changes without full screenshots.
// After actions (click/type/navigate), we start screencast briefly, compare frames,
// and report whether the page changed — saving Claude from taking redundant screenshots.

let screencastState = {
  tabId: null,
  lastFrameHash: null,
  changed: false,
  frameCount: 0,
};

function simpleHash(base64Str) {
  // Fast hash of first 500 chars — enough to detect visual changes
  let h = 0;
  const sample = base64Str.slice(0, 500);
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) - h + sample.charCodeAt(i)) | 0;
  }
  return h;
}

async function startScreencast(tabId) {
  screencastState = { tabId, lastFrameHash: null, changed: false, frameCount: 0 };
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    // Listen for screencast frames
    chrome.debugger.onEvent.addListener(screencastEventHandler);
    await chrome.debugger.sendCommand({ tabId }, 'Page.startScreencast', {
      format: 'jpeg',
      quality: 10,
      maxWidth: 100,
      maxHeight: 100,
      everyNthFrame: 10,
    });
  } catch {}
}

async function stopScreencast() {
  const { tabId } = screencastState;
  if (!tabId) return;
  try {
    chrome.debugger.onEvent.removeListener(screencastEventHandler);
    await chrome.debugger.sendCommand({ tabId }, 'Page.stopScreencast');
    await chrome.debugger.detach({ tabId });
  } catch {}
  const result = { changed: screencastState.changed, frames: screencastState.frameCount };
  screencastState = { tabId: null, lastFrameHash: null, changed: false, frameCount: 0 };
  return result;
}

function screencastEventHandler(source, method, params) {
  if (method !== 'Page.screencastFrame') return;
  if (source.tabId !== screencastState.tabId) return;
  // Acknowledge frame (required by protocol)
  chrome.debugger.sendCommand({ tabId: source.tabId }, 'Page.screencastFrameAck', { sessionId: params.sessionId });
  screencastState.frameCount++;
  const hash = simpleHash(params.data);
  if (screencastState.lastFrameHash !== null && hash !== screencastState.lastFrameHash) {
    screencastState.changed = true;
  }
  screencastState.lastFrameHash = hash;
}

// Monitor page after an action: start screencast, wait, stop, report change
async function detectPageChange(tabId, waitMs = 1500) {
  await startScreencast(tabId);
  await new Promise(r => setTimeout(r, waitMs));
  return await stopScreencast();
}

// ── Tool Execution ──

async function getTargetTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let tab = tabs.find(t => !t.url?.startsWith('chrome-extension://') && !t.url?.startsWith('chrome://'));
  if (!tab) {
    const all = await chrome.tabs.query({});
    tab = all.find(t => t.url?.startsWith('http'));
  }
  if (!tab) throw new Error('No browser tab found. Open a webpage first.');
  return tab.id;
}

async function executeTool(name, args) {
  const tabId = name === 'wait' ? null : await getTargetTab();

  switch (name) {
    case 'screenshot': {
      try {
        const shot = await captureScreenshotOptimized(tabId);
        return { content: [{ type: 'image', source: { type: 'base64', media_type: shot.mediaType, data: shot.base64 } }] };
      } catch {
        // Fallback to simple capture if CDP fails
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 75 });
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.replace(/^data:image\/jpeg;base64,/, '') } }] };
      }
    }
    case 'navigate': {
      if (args.action === 'back') await chrome.tabs.goBack(tabId);
      else if (args.action === 'forward') await chrome.tabs.goForward(tabId);
      else if (args.action === 'refresh') await chrome.tabs.reload(tabId);
      else if (args.url) await chrome.tabs.update(tabId, { url: args.url });
      // Wait for page load (poll readyState, max 10s)
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const r = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.readyState });
          if (r?.[0]?.result === 'complete') break;
        } catch { /* page still loading */ }
      }
      // Get final URL
      const tab = await chrome.tabs.get(tabId);
      return { content: [{ type: 'text', text: `Navigated to: ${tab.url || args.url || args.action} (page loaded — use read_page to see content)` }] };
    }
    case 'click': {
      if (args.ref_id) {
        // Ensure content script
        try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] }); } catch {}
        // ref_id click: lookup element, scroll into view, click center
        const results = await chrome.scripting.executeScript({ target: { tabId }, func: (refId, action) => {
          const map = window.__claudeElementMap;
          if (!map || !map[refId]) return { error: `Element ${refId} not found. Use read_page to refresh.` };
          const el = map[refId].deref();
          if (!el || !document.contains(el)) { delete map[refId]; return { error: `Element ${refId} no longer exists.` }; }
          el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (action === 'left_click' || !action) { el.click(); }
          return { success: true, coordinates: [Math.round(x), Math.round(y)], tag: el.tagName, text: (el.textContent || '').slice(0, 50) };
        }, args: [args.ref_id, args.action] });
        const r = results?.[0]?.result;
        if (r?.error) return { content: [{ type: 'text', text: r.error }] };
        // For non-standard clicks (right, double, triple), use CDP on the computed coordinates
        if (args.action && args.action !== 'left_click' && r?.coordinates) {
          const [x, y] = r.coordinates;
          const count = args.action === 'double_click' ? 2 : args.action === 'triple_click' ? 3 : 1;
          const button = args.action === 'right_click' ? 'right' : 'left';
          await chrome.debugger.attach({ tabId }, '1.3');
          try {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count });
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count });
          } finally { try { await chrome.debugger.detach({ tabId }); } catch {} }
        }
        // Detect page change after click
        const change = await detectPageChange(tabId, 1000);
        const changeNote = change?.changed ? ' (page changed — consider using read_page to see new state)' : ' (page unchanged)';
        return { content: [{ type: 'text', text: `Clicked ${args.ref_id} <${r?.tag}> "${r?.text}" at [${r?.coordinates}]${changeNote}` }] };
      }
      // Coordinate-based click (fallback)
      const [x, y] = scaleCoordinate(...args.coordinate);
      const count = args.action === 'double_click' ? 2 : args.action === 'triple_click' ? 3 : 1;
      const button = args.action === 'right_click' ? 'right' : 'left';
      await chrome.debugger.attach({ tabId }, '1.3');
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: count });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: count });
      } finally { try { await chrome.debugger.detach({ tabId }); } catch {} }
      const clickChange = await detectPageChange(tabId, 1000);
      const clickNote = clickChange?.changed ? ' (page changed)' : '';
      return { content: [{ type: 'text', text: `Clicked [${x},${y}] (${args.action || 'left_click'})${clickNote}` }] };
    }
    case 'type': {
      if (args.ref_id && (args.text || args.key)) {
        try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] }); } catch {}
        // ref_id typing: focus element, set value directly, dispatch events
        const results = await chrome.scripting.executeScript({ target: { tabId }, func: (refId, text, key, clear) => {
          const map = window.__claudeElementMap;
          if (!map || !map[refId]) return { error: `Element ${refId} not found.` };
          const el = map[refId].deref();
          if (!el || !document.contains(el)) { delete map[refId]; return { error: `Element ${refId} no longer exists.` }; }
          el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
          el.focus();
          if (text) {
            if (clear && ('value' in el)) el.value = '';
            if ('value' in el) {
              el.value = (clear ? '' : el.value) + text;
              el.setSelectionRange?.(el.value.length, el.value.length);
            } else if (el.isContentEditable) {
              if (clear) el.textContent = '';
              document.execCommand('insertText', false, text);
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (key) {
            const keyMap = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Space: 32 };
            el.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: keyMap[key] || 0, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode: keyMap[key] || 0, bubbles: true }));
            if (key === 'Enter') el.dispatchEvent(new KeyboardEvent('keypress', { key, keyCode: 13, bubbles: true }));
          }
          return { success: true, tag: el.tagName, value: ('value' in el) ? el.value?.slice(0, 50) : '' };
        }, args: [args.ref_id, args.text || null, args.key || null, args.clear || false] });
        const r = results?.[0]?.result;
        if (r?.error) return { content: [{ type: 'text', text: r.error }] };
        const typeChange = await detectPageChange(tabId, 800);
        const typeNote = typeChange?.changed ? ' (page reacted)' : '';
        return { content: [{ type: 'text', text: `Typed "${args.text || args.key}" into ${args.ref_id} <${r?.tag}> (value: "${r?.value}")${typeNote}` }] };
      }
      // Coordinate-based typing (fallback via CDP + insertText)
      await chrome.debugger.attach({ tabId }, '1.3');
      try {
        if (args.coordinate) {
          const [x, y] = scaleCoordinate(...args.coordinate);
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          await new Promise(r => setTimeout(r, 100));
        }
        if (args.clear) {
          // Select all + delete to clear field
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', windowsVirtualKeyCode: 65, modifiers: 2 });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', windowsVirtualKeyCode: 65, modifiers: 2 });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });
        }
        if (args.text) {
          // Use Input.insertText for fast text entry (handles CJK, paste-like speed)
          await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: args.text });
        }
        if (args.key) {
          const map = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Space: 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
          const code = map[args.key] || 0;
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', key: args.key, windowsVirtualKeyCode: code });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: args.key, windowsVirtualKeyCode: code });
        }
      } finally { try { await chrome.debugger.detach({ tabId }); } catch {} }
      return { content: [{ type: 'text', text: `Typed: ${args.text || args.key || ''}` }] };
    }
    case 'scroll': {
      const amount = args.amount || 500;
      if (args.coordinate) {
        // Scroll at specific position via CDP mouse wheel (more precise)
        const [x, y] = scaleCoordinate(...args.coordinate);
        const dx = args.direction === 'left' ? -amount : args.direction === 'right' ? amount : 0;
        const dy = args.direction === 'up' ? -amount : args.direction === 'down' ? amount : 0;
        await chrome.debugger.attach({ tabId }, '1.3');
        try {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
        } finally { try { await chrome.debugger.detach({ tabId }); } catch {} }
      } else {
        // Global scroll via scripting
        await chrome.scripting.executeScript({ target: { tabId }, func: (dir, amt) => {
          const dx = dir === 'left' ? -amt : dir === 'right' ? amt : 0;
          const dy = dir === 'up' ? -amt : dir === 'down' ? amt : 0;
          window.scrollBy(dx, dy);
        }, args: [args.direction, amount] });
      }
      return { content: [{ type: 'text', text: `Scrolled ${args.direction} ${amount}px` }] };
    }
    case 'hover': {
      const [x, y] = scaleCoordinate(...args.coordinate);
      await chrome.debugger.attach({ tabId }, '1.3');
      try { await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
      finally { try { await chrome.debugger.detach({ tabId }); } catch {} }
      return { content: [{ type: 'text', text: `Hovered [${x},${y}]` }] };
    }
    case 'read_page': {
      // Ensure content script is injected (handles pages opened before extension install)
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
      } catch {}
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (refId, depth, maxChars) => {
        if (typeof window.__generateAccessibilityTree === 'function') {
          return window.__generateAccessibilityTree('all', depth, maxChars, refId);
        }
        return { error: 'Accessibility tree not available. Try refreshing the page.', pageContent: '', viewport: { width: window.innerWidth, height: window.innerHeight } };
      }, args: [args.ref_id || null, args.depth || 15, args.max_chars || 30000] });
      const result = results?.[0]?.result;
      if (result?.error) return { content: [{ type: 'text', text: `Error: ${result.error}` }] };
      const tree = result?.pageContent || 'Empty page';
      const vp = result?.viewport;
      const header = vp ? `[Viewport: ${vp.width}x${vp.height}]\n` : '';
      return { content: [{ type: 'text', text: header + tree }] };
    }
    case 'evaluate': {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: (expr) => { try { return String(eval(expr)); } catch (e) { return 'Error: ' + e.message; } }, args: [args.expression] });
      return { content: [{ type: 'text', text: results?.[0]?.result || 'undefined' }] };
    }
    case 'wait': {
      await new Promise(r => setTimeout(r, args.duration || 2000));
      return { content: [{ type: 'text', text: `Waited ${args.duration || 2000}ms` }] };
    }
    case 'zoom': {
      const cur = await chrome.tabs.getZoom(tabId);
      const z = args.action === 'in' ? Math.min(cur + 0.25, 3) : args.action === 'out' ? Math.max(cur - 0.25, 0.25) : 1;
      await chrome.tabs.setZoom(tabId, z);
      return { content: [{ type: 'text', text: `Zoom: ${Math.round(z * 100)}%` }] };
    }
    case 'drag': {
      const [sx, sy] = scaleCoordinate(...args.start_coordinate);
      const [ex, ey] = scaleCoordinate(...args.coordinate);
      await chrome.debugger.attach({ tabId }, '1.3');
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy, button: 'none' });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
        // Intermediate steps for smooth drag
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
          const mx = sx + (ex - sx) * i / steps;
          const my = sy + (ey - sy) * i / steps;
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(mx), y: Math.round(my), button: 'left', buttons: 1 });
        }
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1 });
      } finally { try { await chrome.debugger.detach({ tabId }); } catch {} }
      return { content: [{ type: 'text', text: `Dragged from [${sx},${sy}] to [${ex},${ey}]` }] };
    }
    case 'key_combo': {
      const keys = args.keys.toLowerCase().split('+').map(k => k.trim());
      await chrome.debugger.attach({ tabId }, '1.3');
      try {
        const modMap = { ctrl: 'Control', cmd: 'Meta', meta: 'Meta', alt: 'Alt', shift: 'Shift', command: 'Meta' };
        const codeMap = { a: 65, c: 67, v: 86, x: 88, z: 90, s: 83, f: 70, l: 76, t: 84, w: 87, r: 82, enter: 13, tab: 9, escape: 27, backspace: 8, delete: 46, space: 32, arrowup: 38, arrowdown: 40, arrowleft: 37, arrowright: 39 };
        const modifiers = keys.filter(k => modMap[k]);
        const mainKey = keys.find(k => !modMap[k]) || '';
        let modBits = 0;
        for (const m of modifiers) {
          if (m === 'alt') modBits |= 1;
          if (m === 'ctrl') modBits |= 2;
          if (m === 'meta' || m === 'cmd' || m === 'command') modBits |= 4;
          if (m === 'shift') modBits |= 8;
        }
        // Press modifiers
        for (const m of modifiers) {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: modMap[m], modifiers: modBits });
        }
        // Press main key
        if (mainKey) {
          const vk = codeMap[mainKey] || mainKey.toUpperCase().charCodeAt(0);
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: mainKey.length === 1 ? mainKey : mainKey.charAt(0).toUpperCase() + mainKey.slice(1), windowsVirtualKeyCode: vk, modifiers: modBits });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: mainKey.length === 1 ? mainKey : mainKey.charAt(0).toUpperCase() + mainKey.slice(1), windowsVirtualKeyCode: vk, modifiers: modBits });
        }
        // Release modifiers
        for (const m of modifiers.reverse()) {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: modMap[m] });
        }
      } finally { try { await chrome.debugger.detach({ tabId }); } catch {} }
      return { content: [{ type: 'text', text: `Pressed: ${args.keys}` }] };
    }
    case 'page_info': {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({
        url: location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        readyState: document.readyState,
        domNodes: document.querySelectorAll('*').length,
        iframeCount: document.querySelectorAll('iframe').length,
      }) });
      const info = results?.[0]?.result || {};
      return { content: [{ type: 'text', text: `URL: ${info.url}\nTitle: ${info.title}\nViewport: ${info.viewport?.width}x${info.viewport?.height}\nReady: ${info.readyState}\nDOM nodes: ${info.domNodes}\nIframes: ${info.iframeCount}` }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// ── API Retry (429/500/502/503) ──

async function fetchWithRetry(url, opts, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok || res.status < 429) return res;
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxRetries) return res;
      const wait = Math.min(1000 * Math.pow(2, attempt), 8000);
      const retryAfter = res.headers.get('retry-after');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : wait;
      setStatus(`Rate limited, retrying in ${Math.round(delay/1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}

// ── SSE Parser ──

async function* parseSSE(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (d === '[DONE]') return;
      try { yield JSON.parse(d); } catch {}
    }
  }
}

// ── Conversation Pruning ──
// Remove old screenshots from conversation to save tokens.
// Keep text and tool_result text, but strip base64 images older than last N turns.
const MAX_IMAGE_HISTORY = 4; // Keep images from last 4 messages only

function pruneConversation(messages) {
  if (messages.length <= MAX_IMAGE_HISTORY) return messages;
  return messages.map((msg, i) => {
    if (i >= messages.length - MAX_IMAGE_HISTORY) return msg; // Keep recent
    if (!Array.isArray(msg.content)) return msg;
    // Strip base64 images from old messages, replace with text placeholder
    const pruned = msg.content.map(block => {
      if (block.type === 'image') return { type: 'text', text: '[screenshot — removed to save tokens]' };
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        return { ...block, content: block.content.map(b => b.type === 'image' ? { type: 'text', text: '[screenshot]' } : b) };
      }
      return block;
    });
    return { ...msg, content: pruned };
  });
}

// ── Agent Loop ──

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isRunning) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  addMsg('user', text);

  // Build user content with optional images
  const userContent = [];
  for (const img of pendingImages) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  }
  userContent.push({ type: 'text', text });
  conversation.push({ role: 'user', content: userContent.length === 1 ? text : userContent });
  pendingImages = [];
  attachmentsEl.innerHTML = '';

  await runAgentLoop();
}

async function runAgentLoop() {
  setRunning(true);
  abortController = new AbortController();

  try {
    for (let step = 1; step <= MAX_LOOPS; step++) {
      setStatus(`Thinking... (step ${step})`);

      const body = {
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: pruneConversation(conversation),
        stream: true,
      };
      // Extended thinking
      if (thinkingEnabled) {
        body.thinking = { type: 'enabled', budget_tokens: THINKING_BUDGET };
      }

      const res = await fetchWithRetry(`${API_URL}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'Authorization': 'Bearer dev-local-token' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) { addMsg('system', `API Error ${res.status}: ${await res.text()}`); break; }

      // Parse response
      const blocks = [];
      let textDiv = null, textBuf = '', toolBuf = null, stopReason = null;

      for await (const evt of parseSSE(res)) {
        if (abortController.signal.aborted) break;
        switch (evt.type) {
          case 'content_block_start':
            if (evt.content_block?.type === 'text') { textDiv = addMsg('ai', ''); textBuf = ''; }
            else if (evt.content_block?.type === 'tool_use') { toolBuf = { id: evt.content_block.id, name: evt.content_block.name, input: '' }; }
            else if (evt.content_block?.type === 'thinking') { textDiv = addThinking(''); textBuf = ''; setStatus('Thinking deeply...'); }
            break;
          case 'content_block_delta':
            if (evt.delta?.type === 'text_delta') { textBuf += evt.delta.text; if (textDiv) textDiv.innerHTML = renderMarkdown(textBuf); scrollBottom(); }
            else if (evt.delta?.type === 'input_json_delta' && toolBuf) { toolBuf.input += evt.delta.partial_json; }
            else if (evt.delta?.type === 'thinking_delta') { textBuf += evt.delta.thinking; if (textDiv) textDiv.textContent = textBuf; scrollBottom(); }
            break;
          case 'content_block_stop':
            if (textBuf && textDiv && !textDiv.classList.contains('thinking')) {
              blocks.push({ type: 'text', text: textBuf });
              // Add copy button
              const btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = '📋';
              btn.onclick = () => { navigator.clipboard.writeText(textBuf); btn.textContent = '✓'; setTimeout(() => btn.textContent = '📋', 1000); };
              textDiv.appendChild(btn);
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
      if (toolUses.length === 0 || stopReason === 'end_turn') break;

      // Execute tools
      const results = [];
      for (const tool of toolUses) {
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
      endToolGroup();
      conversation.push({ role: 'user', content: results });
    }
  } catch (err) {
    if (err.name !== 'AbortError') addMsg('system', `Error: ${err.message}`);
  } finally {
    setRunning(false);
    setStatus('');
    inputEl.focus();
    saveCurrentState();
  }
}

// ── Init ──
loadConversations().then(() => {
  if (activeConvId && allConversations[activeConvId]) {
    const conv = allConversations[activeConvId];
    conversation = conv.messages || [];
    messagesEl.innerHTML = conv.displayMessages || '';
    scrollBottom();
  } else {
    createConversation();
  }
  renderConversationList();
});
setStatus('Ready');
setTimeout(() => setStatus(''), 1500);
