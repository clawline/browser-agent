// Clawline Browser Agent — Service Worker
// Handles: side panel toggle, native messaging hook, sidepanel port routing

// ── State (declared early so error handlers can access) ──
let nativePort = null;

// Latest hook port reported by the native host (via type:'hook_port' message).
// null until the host's HTTP server starts and reports its bound port.
let hookPort = null;

// ── Error logging — capture service worker errors ──
self.addEventListener('error', (e) => {
  if (nativePort) {
    try {
      nativePort.postMessage({
        type: 'error_log',
        error: {
          message: e.message || String(e),
          source: e.filename || '',
          line: e.lineno || 0,
          col: e.colno || 0,
          stack: e.error?.stack || '',
          timestamp: new Date().toISOString(),
          from: 'service-worker',
        },
      });
    } catch (e) { console.warn('[clawline] failed to send error log:', e.message); }
  }
});

self.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (nativePort) {
    try {
      nativePort.postMessage({
        type: 'error_log',
        error: {
          message: 'Unhandled Promise rejection: ' + (err?.message || String(err)),
          stack: err?.stack || '',
          timestamp: new Date().toISOString(),
          from: 'service-worker',
        },
      });
    } catch (e) { console.warn('[clawline] failed to send rejection log:', e.message); }
  }
});

// ── Side Panel ──
// Same pattern as Claude's extension:
// 1. action.onClicked → setOptions (per-tab) + open (no await)
// 2. Create a tab group for the target tab (title "Clawline", color orange)

async function openSidePanel(tab) {
  const tabId = tab.id;
  if (!tabId) return;

  // Open side panel (no await between these two — preserves user gesture)
  chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
  chrome.sidePanel.open({ tabId });

  // Create tab group (same as Claude's extension)
  try {
    const t = await chrome.tabs.get(tabId);
    // If tab is already in a group, skip
    if (t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: 'Clawline',
      color: chrome.tabGroups.Color.ORANGE,
      collapsed: false,
    });
  } catch (e) {
    console.log('[clawline] tab group creation skipped:', e.message);
  }
}

chrome.action.onClicked.addListener(openSidePanel);

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-side-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab) openSidePanel(tab);
    });
  }
});

// ── Native Messaging ──

// Sidepanel port registry (declared before connectNativeHost which references it)
const sidepanelPorts = new Map(); // windowId → port

// Native host connection state
let reconnectAttempt = 0;
let reconnectTimer = null;
let heartbeatTimer = null;
let heartbeatFailCount = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const HEARTBEAT_INTERVAL = 10000; // 10 seconds
const HEARTBEAT_TIMEOUT = 5000; // 5 seconds
const MAX_HEARTBEAT_FAILS = 3;

// Broadcast hook bridge status to all sidepanels
function broadcastHookStatus() {
  const status = { type: 'hook_status', connected: !!nativePort, port: hookPort };
  for (const [, port] of sidepanelPorts) {
    try { port.postMessage(status); } catch (e) { console.warn('[clawline] broadcast status failed:', e.message); }
  }
}

function startHeartbeat() {
  stopHeartbeat(); // Clear any existing timer

  heartbeatTimer = setInterval(() => {
    if (!nativePort) {
      stopHeartbeat();
      return;
    }

    let timeoutTimer = null;
    let responded = false;

    const pingListener = (msg) => {
      if (msg.type === 'pong') {
        responded = true;
        heartbeatFailCount = 0;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        nativePort.onMessage.removeListener(pingListener);
      }
    };

    nativePort.onMessage.addListener(pingListener);

    // Send ping
    try {
      nativePort.postMessage({ type: 'ping', timestamp: Date.now() });
    } catch (e) {
      console.warn('[clawline] heartbeat ping failed:', e.message);
      stopHeartbeat();
      return;
    }

    // Set timeout for response
    timeoutTimer = setTimeout(() => {
      nativePort.onMessage.removeListener(pingListener);
      if (!responded) {
        heartbeatFailCount++;
        console.warn(`[clawline] heartbeat timeout (${heartbeatFailCount}/${MAX_HEARTBEAT_FAILS})`);

        if (heartbeatFailCount >= MAX_HEARTBEAT_FAILS) {
          console.log('[clawline] max heartbeat failures, reconnecting...');
          stopHeartbeat();
          // Force disconnect and reconnect
          if (nativePort) {
            try { nativePort.disconnect(); } catch {}
            nativePort = null;
          }
          connectNativeHost();
        }
      }
    }, HEARTBEAT_TIMEOUT);
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatFailCount = 0;
}

function connectNativeHost() {
  if (nativePort) {
    console.log('[clawline] native host already connected, skipping');
    return;
  }

  // Clear any pending reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    console.log('[clawline] attempting native host connection...');
    nativePort = chrome.runtime.connectNative('com.clawline.agent');

    nativePort.onMessage.addListener(handleNativeMessage);

    nativePort.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError;
      const errorMsg = lastError ? lastError.message : 'unknown reason';
      console.log('[clawline] native host disconnected:', errorMsg);

      stopHeartbeat(); // Stop heartbeat on disconnect
      nativePort = null;
      hookPort = null;
      broadcastHookStatus();

      // Attempt to reconnect with exponential backoff
      reconnectAttempt++;
      if (reconnectAttempt <= MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempt - 1),
          MAX_RECONNECT_DELAY
        );
        console.log(`[clawline] will reconnect in ${delay}ms (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectNativeHost();
        }, delay);
      } else {
        console.log('[clawline] max reconnect attempts reached, giving up');
      }
    });

    // Connection successful - reset reconnect counter
    reconnectAttempt = 0;
    console.log('[clawline] native host connected');
    broadcastHookStatus();

    // Start heartbeat to monitor connection health
    startHeartbeat();
  } catch (e) {
    console.log('[clawline] native host connect failed:', e.message);
    nativePort = null;
    broadcastHookStatus();

    // Retry on connection error with backoff
    reconnectAttempt++;
    if (reconnectAttempt <= MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempt - 1),
        MAX_RECONNECT_DELAY
      );
      console.log(`[clawline] will retry connection in ${delay}ms (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectNativeHost();
      }, delay);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => { connectNativeHost(); });
chrome.runtime.onStartup.addListener(() => { connectNativeHost(); });

// Connect on every service worker wake-up (top level runs each time)
connectNativeHost();

// ── Sidepanel Port Registry ──

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;

  // Ensure native host is connected when sidepanel arrives
  connectNativeHost();

  let registeredWindowId = null;
  // Track unregistered port as fallback
  const tempId = '__unregistered_' + Date.now();
  sidepanelPorts.set(tempId, port);

  port.onMessage.addListener((msg) => {
    if (msg.type === 'register') {
      // Remove temp entry, register with real windowId
      sidepanelPorts.delete(tempId);
      registeredWindowId = msg.windowId;
      sidepanelPorts.set(msg.windowId, port);
      console.log('[clawline] sidepanel registered, windowId:', msg.windowId);
      // Send current hook status immediately
      try { port.postMessage({ type: 'hook_status', connected: !!nativePort, port: hookPort }); } catch (e) { console.warn('[clawline] send hook_status failed:', e.message); }
      return;
    }
    if (msg.type === 'hook_response') {
      if (nativePort) {
        try { nativePort.postMessage(msg); } catch (e) { console.warn('[clawline] forward hook_response failed:', e.message); }
      }
      return;
    }
    if (msg.type === 'error_log') {
      if (nativePort) {
        try { nativePort.postMessage(msg); } catch (e) { console.warn('[clawline] forward error_log failed:', e.message); }
      }
      return;
    }
  });

  port.onDisconnect.addListener(() => {
    sidepanelPorts.delete(tempId);
    if (registeredWindowId !== null) {
      sidepanelPorts.delete(registeredWindowId);
    }
  });
});

// ── Message Routing (Native Host → Sidepanel) ──

async function handleNativeMessage(msg) {
  // Native host reports its bound HTTP port (sent on host startup or rebind)
  if (msg.type === 'hook_port' && typeof msg.port === 'number') {
    hookPort = msg.port;
    console.log('[clawline] native host port:', hookPort);
    broadcastHookStatus();
    return;
  }

  // List sessions — now enriched with window focus + tab info
  if (msg.action === 'list_sessions') {
    const sessions = [];
    const manifest = chrome.runtime.getManifest();
    for (const [windowId] of sidepanelPorts) {
      if (typeof windowId !== 'number') {
        // Unregistered placeholder — skip, not a real Chrome window
        continue;
      }
      const session = { windowId };
      try {
        const win = await chrome.windows.get(windowId);
        session.focused = !!win.focused;
        session.windowType = win.type;
        session.incognito = !!win.incognito;
      } catch {}
      try {
        const tabs = await chrome.tabs.query({ windowId });
        session.tabCount = tabs.length;
        // Full tab list (cap to keep payload bounded). Useful for skill preflight
        // to target a specific tab by id without first running tabs_context.
        session.tabs = tabs.slice(0, 64).map(t => ({
          id: t.id,
          title: (t.title || '').slice(0, 120),
          url: t.url || '',
          active: !!t.active,
          pinned: !!t.pinned,
          discarded: !!t.discarded,
        }));
        const active = tabs.find(t => t.active);
        if (active) {
          session.activeTab = {
            id: active.id,
            title: (active.title || '').slice(0, 120),
            url: active.url || '',
          };
        }
      } catch {}
      sessions.push(session);
    }
    const payload = {
      type: 'sessions',
      sessions,
      extensionVersion: manifest.version,
      extensionName: manifest.name,
    };
    if (nativePort) {
      try { nativePort.postMessage(payload); } catch (e) { console.warn('[clawline] send sessions failed:', e.message); }
    }
    return;
  }

  // Stop task
  if (msg.type === 'hook_stop') {
    // Broadcast to all sidepanels — they'll check the taskId
    for (const [, port] of sidepanelPorts) {
      try { port.postMessage(msg); } catch (e) { console.warn('[clawline] broadcast hook_stop failed:', e.message); }
    }
    return;
  }

  // Route task to target sidepanel
  let targetPort = null;

  if (msg.windowId && sidepanelPorts.has(msg.windowId)) {
    targetPort = sidepanelPorts.get(msg.windowId);
  } else if (msg.tabId) {
    try {
      const tab = await chrome.tabs.get(msg.tabId);
      if (sidepanelPorts.has(tab.windowId)) {
        targetPort = sidepanelPorts.get(tab.windowId);
      } else {
        // Open sidepanel for this tab
        chrome.sidePanel.setOptions({ tabId: msg.tabId, path: 'sidepanel.html', enabled: true });
        chrome.sidePanel.open({ windowId: tab.windowId });
        // Poll for sidepanel registration (200ms intervals, 5s timeout)
        for (let i = 0; i < 25; i++) {
          await new Promise(r => setTimeout(r, 200));
          if (sidepanelPorts.has(tab.windowId)) break;
        }
        targetPort = sidepanelPorts.get(tab.windowId);
      }
    } catch (e) {
      if (nativePort) {
        try {
          nativePort.postMessage({
            type: 'hook_response',
            taskId: msg.taskId,
            status: 'error',
            error: `Tab ${msg.tabId} not found: ${e.message}`,
          });
        } catch (e2) { console.warn('[clawline] send tab error failed:', e2.message); }
      }
      return;
    }
  } else {
    // Find the most recently focused window with a sidepanel
    try {
      const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
      // Sort by focused state
      const focused = wins.find(w => w.focused);
      const targetWin = focused || wins[0];
      if (targetWin && sidepanelPorts.has(targetWin.id)) {
        targetPort = sidepanelPorts.get(targetWin.id);
      } else if (sidepanelPorts.size > 0) {
        // Fall back to any connected sidepanel
        targetPort = sidepanelPorts.values().next().value;
      }
    } catch (e) { console.warn('[clawline] window lookup failed:', e.message); }
  }

  if (!targetPort) {
    if (nativePort) {
      try {
        nativePort.postMessage({
          type: 'hook_response',
          taskId: msg.taskId,
          status: 'error',
          error: 'No sidepanel available. Open the extension side panel first.',
        });
      } catch (e) { console.warn('[clawline] send no-sidepanel error failed:', e.message); }
    }
    return;
  }

  try {
    targetPort.postMessage({ type: 'hook_task', ...msg });
  } catch (e) {
    if (nativePort) {
      try {
        nativePort.postMessage({
          type: 'hook_response',
          taskId: msg.taskId,
          status: 'error',
          error: 'Failed to send to sidepanel: ' + e.message,
        });
      } catch {}
    }
  }
}
