chrome.webNavigation.onBeforeNavigate.addListener(async function(details) {
  const { blockedSites = [] } = await chrome.storage.sync.get(['blockedSites']);
  const url = new URL(details.url);
  
  if (blockedSites.some(site => url.hostname.includes(site))) {
    chrome.tabs.update(details.tabId, {
      url: chrome.runtime.getURL('blocked.html')
    });
  }
});