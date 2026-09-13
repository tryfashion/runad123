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
  const scripts = Array.from(document.scripts).map((script) => ({
    src: script.src,
    text: script.src ? '' : (script.textContent ?? '').slice(0, 5000),
  }));
  const scriptHaystack = scripts.map((script) => script.src + '\n' + script.text).join('\n');
  const marker =
    !!shopify ||
    !!document.querySelector('script[src*="cdn.shopify.com"],script[src*="/cdn/shop/"]') ||
    /Shopify\.(shop|routes|theme)/.test(scriptHaystack);

  const pixelRules: Array<[string, RegExp]> = [
    ['Meta Pixel', /connect\.facebook\.net|fbq\(|facebook\.com\/tr/i],
    ['Google Tag', /googletagmanager\.com|gtag\(|google-analytics\.com|G-[A-Z0-9]+/i],
    ['TikTok Pixel', /analytics\.tiktok\.com|ttq\(/i],
    ['Pinterest Tag', /ct\.pinterest\.com|pintrk\(/i],
    ['Snap Pixel', /sc-static\.net|snaptr\(/i],
    ['Microsoft Clarity', /clarity\.ms|clarity\(/i],
  ];
  const pixels = uniq(
    pixelRules.filter(([, rule]) => rule.test(scriptHaystack)).map(([name]) => name),
  );

  const appRules: Array<[string, RegExp]> = [
    ['Klaviyo', /klaviyo/i],
    ['Judge.me', /judge\.me|judgeme/i],
    ['Loox', /loox/i],
    ['Yotpo', /yotpo/i],
    ['Gorgias', /gorgias/i],
    ['Recharge', /recharge/i],
    ['Shopify Reviews', /productreviews\.shopifycdn/i],
    ['Afterpay', /afterpay/i],
    ['Shop Pay', /shopify_pay|shop-pay/i],
    ['Hotjar', /hotjar/i],
    ['Triple Whale', /triplewhale/i],
    ['Postscript', /postscript/i],
  ];
  const apps = uniq(appRules.filter(([, rule]) => rule.test(scriptHaystack)).map(([name]) => name));

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
  let firstPublished = '';
  let latestPublished = '';
  let lowestPrice: number | null = null;
  let averagePrice: number | null = null;
  let highestPrice: number | null = null;
  try {
    if (marker) {
      const response = await fetch(new URL('/products.json?limit=50', location.origin), {
        credentials: 'omit',
        cache: 'no-store',
      });
      if (response.ok) {
        const body = (await response.json()) as { products?: unknown[] };
        const products = Array.isArray(body.products) ? body.products : [];
        productsRead = products.length;
        const dates = products
          .map((product) => text((product as { published_at?: unknown }).published_at))
          .filter(Boolean)
          .sort();
        firstPublished = dates[0] ?? '';
        latestPublished = dates.at(-1) ?? '';
        const prices = products
          .flatMap((product) =>
            Array.isArray((product as { variants?: unknown }).variants)
              ? ((product as { variants: Array<{ price?: unknown }> }).variants ?? []).map(
                  (variant) => money(variant.price),
                )
              : [],
          )
          .filter((price): price is number => price !== null);
        if (prices.length) {
          lowestPrice = Math.min(...prices);
          highestPrice = Math.max(...prices);
          averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        }
      }
    }
  } catch {
    /* Public Shopify product JSON is optional. */
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
    collectionsRead: collectionLinks.length,
    firstPublished,
    latestPublished,
    lowestPrice,
    averagePrice,
    highestPrice,
    pixels,
    apps,
    metaAdsUrl,
  };
}
export type WebsiteOverview = Awaited<ReturnType<typeof readWebsite>>;
