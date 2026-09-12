// Executed in the selected page's isolated world. Keep this function self-contained.
export async function collectPage() {
  const state = globalThis as typeof globalThis & { runadCollector?: AbortController };
  state.runadCollector?.abort();
  const controller = new AbortController();
  state.runadCollector = controller;
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const initial = location.href,
      url = new URL(initial),
      match = /^(\/[^/]+)?(?:\/collections\/[^/]+)?\/products\/([^/]+)\/?$/.exec(url.pathname);
    if (!match?.[2]) return { error: 'UNSUPPORTED_PRODUCT' };
    const marked =
      !!document.querySelector(
        'script[src*="cdn.shopify.com"],script[src*="/cdn/shop/"],link[href*="cdn.shopify.com"],link[href*="/cdn/shop/"]',
      ) ||
      Array.from(document.scripts).some(
        (s) => !s.src && /Shopify\.(shop|routes|theme)/.test(s.textContent ?? ''),
      );
    if (!marked) return { error: 'UNSUPPORTED_PRODUCT' };
    if (
      document.querySelector('[name^="properties["][required],input[name="selling_plan"][required]')
    )
      return { error: 'UNSUPPORTED_PRODUCT' };
    const root = url.origin + (match[1] ?? '') + '/',
      product = root + 'products/' + match[2];
    async function read(endpoint: string) {
      const response = await fetch(endpoint, {
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('SOURCE_UNAVAILABLE');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('SOURCE_UNAVAILABLE');
      const decoder = new TextDecoder();
      let output = '',
        size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('BODY_TOO_LARGE');
          }
          output += decoder.decode(value, { stream: true });
        }
        output += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      return output;
    }
    async function currency() {
      const body = JSON.parse(await read(root + 'cart.js')) as { currency?: unknown };
      if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))
        throw new Error('CURRENCY_UNVERIFIED');
      return body.currency;
    }
    const before = await currency();
    let raw: string,
      method: 'ajax_js' | 'product_json' = 'ajax_js';
    let fallbackCurrency: string | undefined;
    try {
      raw = await read(product + '.js');
    } catch (error) {
      if (controller.signal.aborted) throw error;
      raw = await read(product + '.json');
      method = 'product_json';
      const data = JSON.parse(raw) as { product?: { currency?: unknown } };
      if (typeof data.product?.currency === 'string') fallbackCurrency = data.product.currency;
    }
    const after = await currency();
    if (before !== after) throw new Error('CURRENCY_CHANGED');
    if (location.href !== initial) throw new Error('SOURCE_CHANGED');
    return {
      raw,
      method,
      currency: before,
      pageUrl: initial,
      verifiedFallbackCurrency: fallbackCurrency,
    };
  } catch (error) {
    return {
      error: controller.signal.aborted
        ? 'CAPTURE_CANCELLED'
        : error instanceof Error
          ? error.message
          : 'SOURCE_UNAVAILABLE',
    };
  } finally {
    clearTimeout(timer);
    if (state.runadCollector === controller) delete state.runadCollector;
  }
}
