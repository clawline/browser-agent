// Clawline Browser Agent — Service Worker
// Handles: side panel toggle, native messaging hook, sidepanel port routing

// ── Side Panel Setup ──

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
  connectNativeHost();
});

chrome.runtime.onStartup.addListener(() => {
  connectNativeHost();
});

// Keyboard shortcut — open side panel
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-side-panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
      chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    }
  }
});

// ── Native Messaging ──

let nativePort = null;

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
    for (const [windowId, port] of sidepanelPorts) {
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
        // Open sidepanel in that window
        await chrome.sidePanel.open({ windowId: tab.windowId });
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
