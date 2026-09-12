import './download-background';
import './product-background';
import './auth-background';
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

// Register synchronously so service worker restarts retain listeners.
chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});
chrome.runtime.onStartup.addListener(() => {
  void initialize();
});
void initialize().catch(() => console.error('EXTENSION_INITIALIZATION_FAILED'));
