// Executed in the selected page's isolated world. Keep these functions self-contained.
type ReadResult = {
  raw?: string;
  method?: 'ajax_js' | 'product_json';
  currency?: string;
  pageUrl?: string;
  verifiedFallbackCurrency?: string;
  error?: string;
};

type CollectionResult = {
  products?: ReadResult[];
  collectionUrl?: string;
  count?: number;
  failed?: number;
  error?: string;
};

async function readText(endpoint: string, signal: AbortSignal, limit = 2 * 1024 * 1024) {
  const response = await fetch(endpoint, {
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
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
      if (size > limit) {
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

function isShopifyPage() {
  return (
    !!document.querySelector(
      'script[src*="cdn.shopify.com"],script[src*="/cdn/shop/"],link[href*="cdn.shopify.com"],link[href*="/cdn/shop/"]',
    ) ||
    Array.from(document.scripts).some(
      (s) => !s.src && /Shopify\.(shop|routes|theme)/.test(s.textContent ?? ''),
    )
  );
}

async function readCurrency(root: string, signal: AbortSignal) {
  const body = JSON.parse(await readText(root + 'cart.js', signal)) as { currency?: unknown };
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))
    throw new Error('CURRENCY_UNVERIFIED');
  return body.currency;
}

async function readOneProduct(
  root: string,
  handle: string,
  pageUrl: string,
  signal: AbortSignal,
): Promise<ReadResult> {
  const product = root + 'products/' + encodeURIComponent(handle);
  let raw: string,
    method: 'ajax_js' | 'product_json' = 'ajax_js';
  let fallbackCurrency: string | undefined;
  try {
    raw = await readText(product + '.js', signal);
  } catch (error) {
    if (signal.aborted) throw error;
    raw = await readText(product + '.json', signal);
    method = 'product_json';
    const data = JSON.parse(raw) as { product?: { currency?: unknown } };
    if (typeof data.product?.currency === 'string') fallbackCurrency = data.product.currency;
  }
  return { raw, method, pageUrl, verifiedFallbackCurrency: fallbackCurrency };
}

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
    if (!isShopifyPage()) return { error: 'UNSUPPORTED_PRODUCT' };
    if (
      document.querySelector('[name^="properties["][required],input[name="selling_plan"][required]')
    )
      return { error: 'UNSUPPORTED_PRODUCT' };
    const root = url.origin + (match[1] ?? '') + '/';
    const before = await readCurrency(root, controller.signal);
    const result = await readOneProduct(root, match[2], initial, controller.signal);
    const after = await readCurrency(root, controller.signal);
    if (before !== after) throw new Error('CURRENCY_CHANGED');
    if (location.href !== initial) throw new Error('SOURCE_CHANGED');
    return { ...result, currency: before };
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

export async function collectCollectionPage(): Promise<CollectionResult> {
  const state = globalThis as typeof globalThis & { runadCollector?: AbortController };
  state.runadCollector?.abort();
  const controller = new AbortController();
  state.runadCollector = controller;
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const initial = location.href,
      url = new URL(initial),
      match = /^(\/[^/]+)?\/collections\/([^/?#]+)\/?$/.exec(url.pathname);
    if (!match?.[2]) return { error: 'UNSUPPORTED_COLLECTION' };
    if (!isShopifyPage()) return { error: 'UNSUPPORTED_COLLECTION' };
    const root = url.origin + (match[1] ?? '') + '/';
    const before = await readCurrency(root, controller.signal);
    const collectionEndpoint =
      root +
      'collections/' +
      encodeURIComponent(decodeURIComponent(match[2])) +
      '/products.json?limit=50';
    const listing = JSON.parse(await readText(collectionEndpoint, controller.signal)) as {
      products?: Array<{ handle?: unknown }>;
    };
    const handles = [
      ...new Set(
        (listing.products ?? [])
          .map((p) => p.handle)
          .filter((h): h is string => typeof h === 'string' && h.length > 0),
      ),
    ].slice(0, 50);
    if (!handles.length) return { error: 'COLLECTION_EMPTY' };
    const products: ReadResult[] = [];
    let failed = 0;
    for (const handle of handles) {
      try {
        products.push(
          await readOneProduct(
            root,
            handle,
            root + 'products/' + encodeURIComponent(handle),
            controller.signal,
          ),
        );
      } catch {
        failed += 1;
      }
    }
    const after = await readCurrency(root, controller.signal);
    if (before !== after) throw new Error('CURRENCY_CHANGED');
    if (location.href !== initial) throw new Error('SOURCE_CHANGED');
    if (!products.length) return { error: 'SOURCE_UNAVAILABLE' };
    return {
      products: products.map((p) => ({ ...p, currency: before })),
      collectionUrl:
        url.origin +
        (match[1] ?? '') +
        '/collections/' +
        encodeURIComponent(decodeURIComponent(match[2])),
      count: products.length,
      failed,
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
