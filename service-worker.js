// Clawline Browser Agent — Service Worker
// Handles: side panel toggle, native messaging hook, sidepanel port routing

// ── State (declared early so error handlers can access) ──
let nativePort = null;

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
    } catch {}
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
    } catch {}
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

function connectNativeHost() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative('com.clawline.agent');
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
    });
    console.log('[clawline] native host connected');
  } catch (e) {
    console.log('[clawline] native host connect failed:', e.message);
    nativePort = null;
  }
}

chrome.runtime.onInstalled.addListener(() => { connectNativeHost(); });
chrome.runtime.onStartup.addListener(() => { connectNativeHost(); });

// Connect on every service worker wake-up (top level runs each time)
connectNativeHost();

// ── Sidepanel Port Registry ──

const sidepanelPorts = new Map(); // windowId → port

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
      return;
    }
    if (msg.type === 'hook_response') {
      if (nativePort) {
        try { nativePort.postMessage(msg); } catch {}
      }
      return;
    }
    if (msg.type === 'error_log') {
      if (nativePort) {
        try { nativePort.postMessage(msg); } catch {}
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
  // List sessions
  if (msg.action === 'list_sessions') {
    const sessions = [];
    for (const [windowId] of sidepanelPorts) {
      sessions.push({ windowId });
    }
    if (nativePort) {
      try { nativePort.postMessage({ type: 'sessions', sessions }); } catch {}
    }
    return;
  }

  // Stop task
  if (msg.type === 'hook_stop') {
    // Broadcast to all sidepanels — they'll check the taskId
    for (const [, port] of sidepanelPorts) {
      try { port.postMessage(msg); } catch {}
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
        // Wait briefly for sidepanel to register
        await new Promise(r => setTimeout(r, 1500));
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
        } catch {}
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
    } catch {}
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
      } catch {}
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
