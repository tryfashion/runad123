export type CatalogItem = {
  handle: string;
  title: string;
  vendor: string;
  type: string;
  image: string;
  price: string | null;
  created: string | null;
  url: string;
};
export type CatalogResult = {
  items: CatalogItem[];
  collections: { handle: string; title: string }[];
  more: boolean;
  collectionsMore: boolean;
  error?: string;
};
// Runs in the site's isolated world. Never fetch arbitrary URLs supplied by the webpage.
export async function readCatalog(input: {
  page: number;
  collection: string;
  kind: 'products' | 'collections';
}): Promise<CatalogResult> {
  const empty: CatalogResult = { items: [], collections: [], more: false, collectionsMore: false };
  const initial = location.href;
  const prefix = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?)(?=\/|$)/.exec(location.pathname)?.[0] ?? '';
  const root = location.origin + prefix;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const path =
      input.kind === 'collections'
        ? '/collections.json?limit=50&page=' + input.page
        : (input.collection ? '/collections/' + encodeURIComponent(input.collection) : '') +
          '/products.json?limit=5&page=' +
          input.page;
    const response = await fetch(root + path, {
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw Error('SOURCE_UNAVAILABLE');
    const reader = response.body?.getReader();
    if (!reader) throw Error('SOURCE_UNAVAILABLE');
    let raw = '',
      size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw Error('BODY_TOO_LARGE');
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    if (location.href !== initial) throw Error('SOURCE_CHANGED');
    const data = JSON.parse(raw);
    if (input.kind === 'collections') {
      if (!Array.isArray(data.collections)) throw Error('SOURCE_UNAVAILABLE');
      return {
        ...empty,
        collections: data.collections
          .filter(
            (c: { handle?: unknown; title?: unknown }) =>
              typeof c.handle === 'string' && typeof c.title === 'string',
          )
          .map((c: { handle: string; title: string }) => ({ handle: c.handle, title: c.title })),
        collectionsMore: data.collections.length === 50,
      };
    }
    if (!Array.isArray(data.products)) throw Error('SOURCE_UNAVAILABLE');
    const items: CatalogItem[] = [];
    for (const p of data.products) {
      if (typeof p.handle !== 'string' || typeof p.title !== 'string') continue;
      const prices = (Array.isArray(p.variants) ? p.variants : [])
        .map((v: { price?: unknown }) => v.price)
        .filter((v: unknown): v is string => typeof v === 'string' && /^\d+(\.\d+)?$/.test(v));
      prices.sort((a: string, b: string) => Number(a) - Number(b));
      const img = p.images?.[0]?.src;
      items.push({
        handle: p.handle,
        title: p.title,
        vendor: typeof p.vendor === 'string' ? p.vendor : '',
        type: typeof p.product_type === 'string' ? p.product_type : '',
        image: typeof img === 'string' && /^https?:\/\//.test(img) ? img : '',
        price: prices[0] ?? null,
        created: typeof p.created_at === 'string' ? p.created_at : null,
        url: root + '/products/' + encodeURIComponent(p.handle),
      });
    }
    return { ...empty, items, more: data.products.length === 5 };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : 'SOURCE_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}
