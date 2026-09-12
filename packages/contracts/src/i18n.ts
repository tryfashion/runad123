export const supportedLocales = ['zh-Hans', 'zh-Hant', 'en'] as const;
export type UiLocale = (typeof supportedLocales)[number];
export type UiPreference = UiLocale | 'auto';

export function isLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && supportedLocales.some((locale) => locale === value);
}

export function parsePreference(value: unknown): UiPreference {
  return value === 'auto' || isLocale(value) ? value : 'auto';
}

export function matchLocale(candidate: string): UiLocale | undefined {
  try {
    const locale = new Intl.Locale(candidate);
    if (locale.language === 'en') return 'en';
    if (locale.language !== 'zh') return undefined;
    if (locale.script === 'Hant') return 'zh-Hant';
    if (locale.script === 'Hans') return 'zh-Hans';
    return ['TW', 'HK', 'MO'].includes(locale.region ?? '') ? 'zh-Hant' : 'zh-Hans';
  } catch {
    return undefined;
  }
}

export function resolveLocale(preference: UiPreference, candidates: readonly string[]): UiLocale {
  if (preference !== 'auto') return preference;
  for (const candidate of candidates) {
    const locale = matchLocale(candidate);
    if (locale) return locale;
  }
  return 'en';
}

export function parseAcceptLanguage(header: string | null): string[] {
  return (header ?? '')
    .split(',')
    .map((entry, index) => {
      const [tag = '', ...parameters] = entry.trim().split(';');
      let quality = 1;
      for (const parameter of parameters) {
        const part = parameter.trim();
        if (!/^q=/i.test(part) || !/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i.test(part)) {
          quality = 0;
          break;
        }
        quality = Number(part.slice(2));
      }
      return { tag: tag.trim(), quality, index };
    })
    .filter((entry) => entry.quality > 0 && Boolean(matchLocale(entry.tag)))
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((entry) => entry.tag);
}

export function resolveWebsiteLocale(
  preference: UiPreference,
  query: unknown,
  candidates: readonly string[],
): UiLocale {
  if (preference !== 'auto') return preference;
  return isLocale(query) ? query : resolveLocale('auto', candidates);
}

const en = {
  language: 'Language',
  auto: 'Follow browser',
  stage: 'Development preview',
  title: 'Prepare your next product.',
  subtitle: 'Collect a Shopify product, review its text and prepare a store import.',
  workspace: 'Product workspace',
  waiting: 'Your product will appear here',
  waitingBody:
    'Product collection is being built. This preview lets you try the interface and language settings.',
  roadmap: 'From discovery to a draft',
  collect: 'Collect product',
  review: 'Review text risks',
  export: 'Export Shopify CSV',
  collectBody: 'Keep variants, prices and product images together.',
  reviewBody: 'Review the title and description before exporting.',
  exportBody: 'Prepare a draft product for your own store.',
  unavailable: 'Coming in the next milestones',
  progress: 'Local features ready · External validation pending',
  status: 'Service status',
  statusLink: 'View service status',
  live: 'Web process is running',
  dependencies: 'Database and task processing are not connected yet.',
  privacy:
    'Creating a draft sends the selected product to runad123. Text checks run on the server.',
  persistenceError: 'Language could not be saved. Your selection works for this session.',
  loading: 'Loading…',
  scope: 'Text checks cover titles and descriptions. Images are not checked.',
  back: 'Back to workspace',
} as const;
export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

export const dictionaries: Record<UiLocale, Dictionary> = {
  en,
  'zh-Hans': {
    language: '语言',
    auto: '跟随浏览器',
    stage: '开发预览',
    title: '为下一个商品做好准备。',
    subtitle: '采集 Shopify 商品，检查文本，准备导入自己的店铺。',
    workspace: '商品工作台',
    waiting: '采集的商品将在这里展示',
    waitingBody: '商品采集功能正在开发。当前预览可体验界面和语言设置。',
    roadmap: '从发现商品到店铺草稿',
    collect: '采集商品',
    review: '检查文本风险',
    export: '导出 Shopify CSV',
    collectBody: '整理商品的规格、价格与图片。',
    reviewBody: '导出前检查标题与描述中的风险信号。',
    exportBody: '为自己的店铺准备商品草稿。',
    unavailable: '将在后续阶段开放',
    progress: '本地功能已实现 · 真实接入待验证',
    status: '服务状态',
    statusLink: '查看服务状态',
    live: '网站进程正在运行',
    dependencies: '数据库和任务处理尚未连接。',
    privacy: '创建草稿会将所选商品发送至 runad123，文本检查在服务端执行。',
    persistenceError: '语言设置未能保存，本次选择仍然有效。',
    loading: '加载中…',
    scope: '文本检查仅覆盖标题和描述，暂不检查图片。',
    back: '返回工作台',
  },
  'zh-Hant': {
    language: '語言',
    auto: '跟隨瀏覽器',
    stage: '開發預覽',
    title: '為下一個商品做好準備。',
    subtitle: '擷取 Shopify 商品，檢查文字，準備匯入自己的商店。',
    workspace: '商品工作台',
    waiting: '擷取的商品將在這裡顯示',
    waitingBody: '商品擷取功能正在開發。目前預覽可體驗介面和語言設定。',
    roadmap: '從發現商品到商店草稿',
    collect: '擷取商品',
    review: '檢查文字風險',
    export: '匯出 Shopify CSV',
    collectBody: '整理商品的規格、價格與圖片。',
    reviewBody: '匯出前檢查標題與描述中的風險訊號。',
    exportBody: '為自己的商店準備商品草稿。',
    unavailable: '將在後續階段開放',
    progress: '本地功能已實作 · 真實接入待驗證',
    status: '服務狀態',
    statusLink: '查看服務狀態',
    live: '網站程序正在執行',
    dependencies: '資料庫和工作處理尚未連接。',
    privacy: '建立草稿會將所選商品傳送至 runad123，文字檢查在服務端執行。',
    persistenceError: '語言設定未能儲存，本次選擇仍然有效。',
    loading: '載入中…',
    scope: '文字檢查僅涵蓋標題和描述，暫不檢查圖片。',
    back: '返回工作台',
  },
};

export function translate(locale: UiLocale, key: MessageKey): string {
  return dictionaries[locale][key] ?? dictionaries.en[key];
}
