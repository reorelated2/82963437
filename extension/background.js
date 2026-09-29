/* Operating Agent — service worker. Opens the side panel, relays nothing else. */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
