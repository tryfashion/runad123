import type { UiLocale } from '@runad123/contracts/i18n';
const en = {
  cached: 'Saved (Beijing time)',
  daily: 'Reused today; refreshed on the next visit after midnight in Beijing.',
  tab: 'Website overview',
  refresh: 'Read current website',
  loading: 'Reading website…',
  unavailable: 'This page cannot be read. Open a website and try again.',
  permission: 'Allow access to this website to read its overview.',
  unknown: 'Not detected',
  platform: 'Platform',
  domain: 'Store domain',
  theme: 'Theme',
  metaAds: 'Meta Ads',
  products: 'Products read',
  collections: 'Collections',
  firstPublished: 'First published',
  latestPublished: 'Latest published',
  currency: 'Currency',
  country: 'Market country',
  language: 'Page language',
  lowestPrice: 'Lowest price',
  averagePrice: 'Average price',
  highestPrice: 'Highest price',
  technologies: 'Detected technology',
  pixels: 'pixels',
  apps: 'apps',
  analytics: 'analytics',
  other: 'other',
  noTechnology: 'No pixels or apps detected on this page.',
  note: 'Based on the current page and public Shopify endpoints. Product counts may be limited by what the store exposes.',
  open: 'Open website',
  title: 'Website overview',
};
const dictionary: Record<UiLocale, typeof en> = {
  en,
  'zh-Hans': {
    cached: '缓存时间（北京时间）',
    daily: '当天使用缓存，北京时间次日再次进入时更新。',
    tab: '网站概览',
    refresh: '读取当前网站',
    loading: '正在读取网站…',
    unavailable: '无法读取此页面，请打开网站后重试。',
    permission: '请允许访问当前网站，以读取网站概览。',
    unknown: '未识别',
    platform: '建站平台',
    domain: '店铺域名',
    theme: '主题',
    metaAds: 'Meta Ads',
    products: '商品数',
    collections: '系列数',
    firstPublished: '首次发布',
    latestPublished: '最近发布',
    currency: '货币',
    country: '国家/地区',
    language: '语言',
    lowestPrice: '最低价',
    averagePrice: '平均价',
    highestPrice: '最高价',
    technologies: '检测到的技术',
    pixels: '像素',
    apps: '应用',
    analytics: '分析',
    other: '其他',
    noTechnology: '当前页面未检测到像素或应用脚本。',
    note: '信息来自当前页面和公开 Shopify 接口；商品数受店铺公开接口限制。',
    open: '打开网站',
    title: '网站概览',
  },
  'zh-Hant': {
    cached: '快取時間（北京時間）',
    daily: '當天使用快取，北京時間次日再次進入時更新。',
    tab: '網站概覽',
    refresh: '讀取目前網站',
    loading: '正在讀取網站…',
    unavailable: '無法讀取此頁面，請開啟網站後重試。',
    permission: '請允許存取目前網站，以讀取網站概覽。',
    unknown: '未識別',
    platform: '建站平台',
    domain: '商店網域',
    theme: '佈景主題',
    metaAds: 'Meta Ads',
    products: '商品數',
    collections: '系列數',
    firstPublished: '首次發佈',
    latestPublished: '最近發佈',
    currency: '貨幣',
    country: '國家/地區',
    language: '語言',
    lowestPrice: '最低價',
    averagePrice: '平均價',
    highestPrice: '最高價',
    technologies: '偵測到的技術',
    pixels: '像素',
    apps: '應用',
    analytics: '分析',
    other: '其他',
    noTechnology: '目前頁面未偵測到像素或應用腳本。',
    note: '資訊來自目前頁面和公開 Shopify 介面；商品數受商店公開介面限制。',
    open: '開啟網站',
    title: '網站概覽',
  },
};
export const overviewText = (locale: UiLocale, key: keyof typeof en) => dictionary[locale][key];

// Serialized by Chrome into the current page; keep this function self-contained.
export async function readWebsite() {
  const text = (value: unknown, max = 250) =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';
  const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean))).slice(0, 12);
  const money = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : null;
  };
  const shopify = (
    window as typeof window & {
      Shopify?: {
        shop?: unknown;
        country?: unknown;
        currency?: { active?: unknown };
        theme?: { name?: unknown };
      };
    }
  ).Shopify;
  const assetValues: string[] = [
    ...Array.from(document.scripts).flatMap((script) => [script.src, script.textContent ?? '']),
    ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[href]')).map(
      (link) => link.href,
    ),
    ...Array.from(document.querySelectorAll<HTMLImageElement>('img[src]')).map(
      (image) => image.src,
    ),
    ...Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]')).map(
      (frame) => frame.src,
    ),
    ...Array.from(document.querySelectorAll('noscript')).map((node) => node.textContent ?? ''),
    document.documentElement.innerHTML.slice(0, 120000),
  ];
  const scriptHaystack = assetValues.join('\n');
  const marker =
    !!shopify ||
    !!document.querySelector('script[src*="cdn.shopify.com"],script[src*="/cdn/shop/"]') ||
    /Shopify\.(shop|routes|theme)/.test(scriptHaystack);

  const pixelRules: Array<[string, RegExp]> = [
    ['Meta Pixel (Facebook/Instagram)', /connect\.facebook\.net|fbq\(|facebook\.com\/tr/i],
    ['Pinterest Tag', /ct\.pinterest\.com|pintrk\(|s\.pinimg\.com|assets\.pinterest\.com/i],
    ['TikTok Pixel', /analytics\.tiktok\.com|ttq\(/i],
    ['Snap Pixel', /sc-static\.net|snaptr\(/i],
  ];
  const analyticsRules: Array<[string, RegExp]> = [
    ['Google Analytics', /googletagmanager\.com|gtag\(|google-analytics\.com|G-[A-Z0-9]+/i],
    ['Microsoft Clarity', /clarity\.ms|clarity\(/i],
    ['Lucky Orange', /luckyorange|lucky-orange/i],
    ['Sensors Data', /sensorsdata|sensors-data|sensors_data/i],
    ['Hotjar', /hotjar/i],
    ['Triple Whale', /triplewhale|triple-whale/i],
  ];
  const appRules: Array<[string, RegExp]> = [
    ['Klaviyo', /klaviyo/i],
    ['Judge.me', /judge\.me|judgeme/i],
    ['Loox', /loox/i],
    ['Yotpo', /yotpo/i],
    ['Gorgias', /gorgias/i],
    ['Recharge', /recharge/i],
    ['Shopify Reviews', /productreviews\.shopifycdn/i],
    ['Afterpay', /afterpay/i],
    ['Postscript', /postscript/i],
    ['Attentive', /attentive/i],
    ['Omnisend', /omnisend/i],
    ['Privy', /privy/i],
    ['Stamped', /stamped/i],
    ['Okendo', /okendo/i],
    ['Smile.io', /smile\.io|smile-ui/i],
    ['PageFly', /pagefly/i],
    ['GemPages', /gempages/i],
    ['Shogun', /shogun/i],
    ['Vitals', /vitals/i],
    ['Avada', /avada/i],
  ];
  const pixels = uniq(
    pixelRules.filter(([, rule]) => rule.test(scriptHaystack)).map(([name]) => name),
  );
  const analytics = uniq(
    analyticsRules.filter(([, rule]) => rule.test(scriptHaystack)).map(([name]) => name),
  );
  const apps = uniq(appRules.filter(([, rule]) => rule.test(scriptHaystack)).map(([name]) => name));
  const ignoredDomains = [
    location.hostname,
    'cdn.shopify.com',
    'shopifycdn.net',
    'myshopify.com',
    'shopify.com',
    'shop.app',
    'schema.org',
    'w3.org',
    'gstatic.com',
    'googleapis.com',
    'google.com',
    'googleusercontent.com',
    'cloudfront.net',
    'fastly.net',
    'cloudflare.com',
    'cloudflareinsights.com',
    'facebook.com',
    'facebook.net',
    'pinterest.com',
    'pinimg.com',
    'tiktok.com',
    'googletagmanager.com',
    'google-analytics.com',
  ];
  const thirdPartyDomains = uniq(
    assetValues
      .flatMap((value) =>
        Array.from(value.matchAll(/https?:\/\/([^\/\s"'<>]+)/gi)).map((match) => match[1] ?? ''),
      )
      .map((host) => host.toLowerCase().replace(/^www\./, ''))
      .filter(
        (host) =>
          host && !ignoredDomains.some((known) => host === known || host.endsWith('.' + known)),
      ),
  );
  const namedTechnology = new Set(
    [...pixels, ...analytics, ...apps].map((item) => item.toLowerCase()),
  );
  const other = thirdPartyDomains.filter(
    (host) =>
      !Array.from(namedTechnology).some((name) => host.includes(name.split(' ')[0] ?? name)),
  );

  const collectionLinks = uniq(
    Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/collections/"]')).map(
      (link) => {
        try {
          const url = new URL(link.href, location.href);
          return url.pathname.replace(/\/$/, '');
        } catch {
          return '';
        }
      },
    ),
  );

  let productsRead = 0;
  let collectionsRead = collectionLinks.length;
  let firstPublished = '';
  let latestPublished = '';
  let lowestPrice: number | null = null;
  let averagePrice: number | null = null;
  let highestPrice: number | null = null;
  const sitemapProductUrls = new Set<string>();
  const sitemapCollectionUrls = new Set<string>();
  const sitemapProductLastmods: string[] = [];
  const productPrices = new Set<number>();
  const addPrice = (value: unknown) => {
    const parsed = money(value);
    if (parsed !== null && parsed >= 0) productPrices.add(parsed);
  };
  const parseProductList = (products: unknown[]) => {
    productsRead = Math.max(productsRead, products.length);
    const dates = products
      .map((product) =>
        text(
          (product as { published_at?: unknown; publishedAt?: unknown; created_at?: unknown })
            .published_at ??
            (product as { publishedAt?: unknown }).publishedAt ??
            (product as { created_at?: unknown }).created_at,
        ),
      )
      .filter(Boolean)
      .sort();
    firstPublished = firstPublished || dates[0] || '';
    latestPublished = latestPublished || dates.at(-1) || '';
    for (const product of products) {
      if (Array.isArray((product as { variants?: unknown }).variants)) {
        for (const variant of (product as { variants: Array<{ price?: unknown }> }).variants) {
          const rawPrice = money(variant.price);
          if (rawPrice !== null) addPrice(rawPrice > 999 ? rawPrice / 100 : rawPrice);
        }
      }
    }
  };
  const parseSitemapXml = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return Array.from(doc.querySelectorAll('url, sitemap')).map((node) => ({
      loc: text(node.querySelector('loc')?.textContent, 2048),
      lastmod: text(node.querySelector('lastmod')?.textContent),
    }));
  };
  try {
    if (marker) {
      const queue = [new URL('/sitemap.xml', location.origin).href];
      const seen = new Set<string>();
      while (queue.length && seen.size < 12) {
        const sitemapUrl = queue.shift()!;
        if (seen.has(sitemapUrl)) continue;
        seen.add(sitemapUrl);
        const response = await fetch(sitemapUrl, { credentials: 'omit', cache: 'no-store' });
        if (!response.ok) continue;
        for (const entry of parseSitemapXml(await response.text())) {
          if (!entry.loc.startsWith(location.origin)) continue;
          if (/sitemap.*\.xml/i.test(entry.loc)) {
            if (/product|collection|sitemap/i.test(entry.loc)) queue.push(entry.loc);
            continue;
          }
          const url = new URL(entry.loc);
          if (/\/products\/[^/?#]+/.test(url.pathname)) {
            sitemapProductUrls.add(url.href);
            if (entry.lastmod) sitemapProductLastmods.push(entry.lastmod);
          } else if (/\/collections\/[^/?#]+/.test(url.pathname)) {
            sitemapCollectionUrls.add(url.href);
          }
        }
      }
      productsRead = Math.max(productsRead, sitemapProductUrls.size);
      collectionsRead = Math.max(collectionsRead, sitemapCollectionUrls.size);
      const sitemapDates = sitemapProductLastmods.filter(Boolean).sort();
      firstPublished = firstPublished || sitemapDates[0] || '';
      latestPublished = latestPublished || sitemapDates.at(-1) || '';

      for (const path of ['/products.json?limit=50', '/collections/all/products.json?limit=50']) {
        const response = await fetch(new URL(path, location.origin), {
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok) continue;
        const body = (await response.json()) as { products?: unknown[] };
        const products = Array.isArray(body.products) ? body.products : [];
        if (products.length) {
          parseProductList(products);
          break;
        }
      }
      if (!productPrices.size && sitemapProductUrls.size) {
        const sample = Array.from(sitemapProductUrls).slice(0, 50);
        for (const productUrl of sample) {
          try {
            const url = new URL(productUrl);
            const jsonUrl = new URL(url.pathname.replace(/\/$/, '') + '.js', location.origin);
            const response = await fetch(jsonUrl, { credentials: 'omit', cache: 'no-store' });
            if (!response.ok) continue;
            parseProductList([await response.json()]);
          } catch {
            /* Ignore individual product JSON failures. */
          }
        }
      }
    }
  } catch {
    /* Public Shopify product and sitemap endpoints are optional. */
  }
  const priceNodes = Array.from(
    document.querySelectorAll(
      '[data-product-id], [data-price], [data-product-price], .price, [class*="price" i]',
    ),
  );
  for (const node of priceNodes) {
    const element = node as HTMLElement;
    addPrice(element.getAttribute('data-price'));
    addPrice(element.getAttribute('data-product-price'));
    const raw = (element.textContent ?? '').replace(/,/g, '');
    const matched = raw.match(/(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
    if (matched) addPrice(matched[1]);
  }
  const jsonLdScripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  );
  for (const script of jsonLdScripts) {
    try {
      const json = JSON.parse(script.textContent || 'null') as unknown;
      const rows = Array.isArray(json) ? json : [json];
      for (const row of rows) {
        const offer = (row as { offers?: unknown })?.offers;
        const offers = Array.isArray(offer) ? offer : offer ? [offer] : [];
        for (const item of offers)
          addPrice(
            (item as { price?: unknown; lowPrice?: unknown; highPrice?: unknown }).price ??
              (item as { lowPrice?: unknown }).lowPrice ??
              (item as { highPrice?: unknown }).highPrice,
          );
      }
    } catch {
      /* Ignore malformed JSON-LD. */
    }
  }
  const prices = Array.from(productPrices);
  if (prices.length) {
    lowestPrice = Math.min(...prices);
    highestPrice = Math.max(...prices);
    averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  }

  const metaAdsUrl = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&search_type=page&view_all_page_id=&q=${encodeURIComponent(location.hostname)}`;
  return {
    url: location.origin,
    pageUrl: location.href,
    name:
      text(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')) ||
      text(document.title),
    host: location.hostname,
    shopify: marker,
    domain: text(shopify?.shop),
    theme: text(shopify?.theme?.name),
    currency: text(shopify?.currency?.active),
    country: text(shopify?.country),
    language: text(document.documentElement.lang),
    productsRead,
    collectionsRead,
    firstPublished,
    latestPublished,
    lowestPrice,
    averagePrice,
    highestPrice,
    pixels,
    apps,
    analytics,
    other,
    metaAdsUrl,
  };
}
export type WebsiteOverview = Awaited<ReturnType<typeof readWebsite>>;
