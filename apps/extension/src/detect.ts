(() => {
  if (!/\/products\/[^/]+/.test(location.pathname)) return;
  const marker = document.querySelector('script[src*="cdn.shopify.com"],script[src*="/cdn/shop/"]');
  if (marker) void chrome.runtime.sendMessage({ action: 'shopifyDetected' }).catch(() => undefined);
})();
