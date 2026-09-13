// Chrome serializes this function into the site's isolated world.
// Detect Shopify from existing page markers only; never wait for network requests.
export function detectShopifyPage() {
  if (document.querySelector('script[src*="cdn.shopify.com"],script[src*="/cdn/shop/"]'))
    return true;
  const shopify = (
    window as typeof window & { Shopify?: { shop?: unknown; routes?: unknown; theme?: unknown } }
  ).Shopify;
  if (shopify && (shopify.shop || shopify.routes || shopify.theme)) return true;
  return Array.from(document.scripts).some(
    (script) => !script.src && /Shopify\.(shop|routes|theme)/.test(script.textContent ?? ''),
  );
}
