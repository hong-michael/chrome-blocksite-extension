document.addEventListener('DOMContentLoaded', function() {
  const websiteInput = document.getElementById('websiteInput');
  const addButton = document.getElementById('addButton');
  const blockedList = document.getElementById('blockedList');

  // Load blocked websites
  loadBlockedWebsites();

  addButton.addEventListener('click', function() {
    const website = websiteInput.value.trim().toLowerCase();
    if (website) {
      chrome.storage.sync.get(['blockedSites'], function(result) {
        const blockedSites = result.blockedSites || [];
        if (!blockedSites.includes(website)) {
          blockedSites.push(website);
          chrome.storage.sync.set({ blockedSites: blockedSites }, function() {
            websiteInput.value = '';
            loadBlockedWebsites();
          });
        }
      });
    }
  });

  function loadBlockedWebsites() {
    chrome.storage.sync.get(['blockedSites'], function(result) {
      const blockedSites = result.blockedSites || [];
      blockedList.innerHTML = '';
      
      blockedSites.forEach(function(site) {
        const div = document.createElement('div');
        div.className = 'blocked-item';
        div.innerHTML = `
          <span>${site}</span>
          <span class="remove-btn" data-site="${site}">×</span>
        `;
        blockedList.appendChild(div);
      });

      // Add remove button listeners
      document.querySelectorAll('.remove-btn').forEach(button => {
        button.addEventListener('click', function() {
          const siteToRemove = this.getAttribute('data-site');
          removeWebsite(siteToRemove);
        });
      });
    });
  }

  function removeWebsite(website) {
    chrome.storage.sync.get(['blockedSites'], function(result) {
      let blockedSites = result.blockedSites || [];
      blockedSites = blockedSites.filter(site => site !== website);
      chrome.storage.sync.set({ blockedSites: blockedSites }, function() {
        loadBlockedWebsites();
      });
    });
  }
});