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
  currency: 'Currency',
  country: 'Market country',
  language: 'Page language',
  note: 'Based on the current page. Market settings do not establish the merchant’s location.',
  open: 'Open website',
  title: 'Website information',
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
    currency: '货币',
    country: '市场国家',
    language: '页面语言',
    note: '信息来自当前页面；市场设置不代表商家所在地。',
    open: '打开网站',
    title: '网站信息',
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
    currency: '貨幣',
    country: '市場國家',
    language: '頁面語言',
    note: '資訊來自目前頁面；市場設定不代表商家所在地。',
    open: '開啟網站',
    title: '網站資訊',
  },
};
export const overviewText = (locale: UiLocale, key: keyof typeof en) => dictionary[locale][key];

// Serialized by Chrome into the current page; keep this function self-contained.
export function readWebsite() {
  const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 250) : '');
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
  const marker =
    !!shopify ||
    !!document.querySelector('script[src*="cdn.shopify.com"],script[src*="/cdn/shop/"]');
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
  };
}
export type WebsiteOverview = ReturnType<typeof readWebsite>;
