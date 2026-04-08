// Clawline Browser Agent — Service Worker

// Open side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Set the side panel for all tabs
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    path: 'sidepanel.html',
    enabled: true,
  });
});

// Keyboard shortcut — simulate action click to open side panel
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-side-panel') {
    // openPanelOnActionClick handles the rest — we just need to
    // programmatically open the panel via the action API
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      // Set panel for this specific tab then open via action
      chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
      chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    }
  }
});
