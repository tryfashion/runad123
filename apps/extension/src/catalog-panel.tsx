import { useEffect, useMemo, useRef, useState } from 'react';
import type { UiLocale } from '@runad123/contracts/i18n';
import type { SourceProduct } from '@runad123/contracts/product';
import type { CatalogItem, CatalogResult } from './catalog-page';
const dictionaries = {
  'zh-Hans': {
    title: '产品',
    all: '全部商品',
    current: '当前商品',
    by: '按系列导出',
    choose: '选择一个系列…',
    exportCollection: '导出系列',
    searchTitle: '搜索与筛选商品',
    search: '按名称、供应商或商品类型搜索…',
    allCollections: '全部系列',
    sort: '排序方式',
    normal: '默认排序',
    newest: '创建时间：最新',
    oldest: '创建时间：最早',
    low: '价格：从低到高',
    high: '价格：从高到低',
    list: '列表视图',
    grid: '网格视图',
    details: '查看详情',
    export: '导出',
    selected: '导出所选',
    price: '价格',
    created: '创建时间',
    load: '加载更多',
    refresh: '刷新',
    loading: '正在读取商品…',
    empty: '没有匹配的商品',
    loaded: '已读取',
    shown: '筛选结果',
    scope: '搜索和排序仅针对已读取的商品。',
    partial: '还有更多商品可读取。',
    cancel: '取消',
    done: 'CSV 已开始下载',
    failed: '读取或导出失败，请重试。',
    limit: '单次最多导出 1000 件，请选择较小的系列或勾选商品。',
    permission: '允许读取当前店铺',
    collectionError: '系列目录暂不可用，可重试。',
    progress: '正在采集',
    unknown: '未知',
    noCurrent: '请进入商品详情页',
    selectedCount: '已选择',
    notice: '仅展示店铺公开数据，不代表销量或热销排名。',
  },
  'zh-Hant': {
    title: '產品',
    all: '全部商品',
    current: '目前商品',
    by: '按系列匯出',
    choose: '選擇一個系列…',
    exportCollection: '匯出系列',
    searchTitle: '搜尋與篩選商品',
    search: '按名稱、供應商或商品類型搜尋…',
    allCollections: '全部系列',
    sort: '排序方式',
    normal: '預設排序',
    newest: '建立時間：最新',
    oldest: '建立時間：最早',
    low: '價格：由低到高',
    high: '價格：由高到低',
    list: '清單檢視',
    grid: '網格檢視',
    details: '查看詳情',
    export: '匯出',
    selected: '匯出所選',
    price: '價格',
    created: '建立時間',
    load: '載入更多',
    refresh: '重新整理',
    loading: '正在讀取商品…',
    empty: '沒有符合的商品',
    loaded: '已讀取',
    shown: '篩選結果',
    scope: '搜尋與排序僅針對已讀取的商品。',
    partial: '還有更多商品可讀取。',
    cancel: '取消',
    done: 'CSV 已開始下載',
    failed: '讀取或匯出失敗，請重試。',
    limit: '單次最多匯出 1000 件，請選擇較小的系列或勾選商品。',
    permission: '允許讀取目前商店',
    collectionError: '系列目錄暫不可用，可重試。',
    progress: '正在擷取',
    unknown: '未知',
    noCurrent: '請進入商品詳情頁',
    selectedCount: '已選擇',
    notice: '僅展示商店公開資料，不代表銷量或熱銷排名。',
  },
  en: {
    title: 'Products',
    all: 'All products',
    current: 'Current product',
    by: 'Export by collection',
    choose: 'Select a collection…',
    exportCollection: 'Export collection',
    searchTitle: 'Search and filter products',
    search: 'Search name, vendor or product type…',
    allCollections: 'All collections',
    sort: 'Sort order',
    normal: 'Default order',
    newest: 'Created: newest',
    oldest: 'Created: oldest',
    low: 'Price: low to high',
    high: 'Price: high to low',
    list: 'List view',
    grid: 'Grid view',
    details: 'View details',
    export: 'Export',
    selected: 'Export selected',
    price: 'Price',
    created: 'Created',
    load: 'Load more',
    refresh: 'Refresh',
    loading: 'Reading products…',
    empty: 'No matching products',
    loaded: 'Loaded',
    shown: 'Matches',
    scope: 'Search and sorting apply to loaded products only.',
    partial: 'More products are available.',
    cancel: 'Cancel',
    done: 'CSV download started',
    failed: 'Could not read or export products. Please retry.',
    limit:
      'Export up to 1,000 products at a time. Select a smaller collection or individual products.',
    permission: 'Allow current store',
    collectionError: 'Collection list unavailable. Please retry.',
    progress: 'Collecting',
    unknown: 'Unknown',
    noCurrent: 'Open a product detail page',
    selectedCount: 'Selected',
    notice: 'Public store data only; no sales or bestseller ranking.',
  },
};
export function CatalogPanel({ locale, url }: { locale: UiLocale; url: string }) {
  const t = dictionaries[locale];
  const [items, setItems] = useState<CatalogItem[]>([]),
    [collections, setCollections] = useState<{ handle: string; title: string }[]>([]);
  const [filter, setFilter] = useState(''),
    [exportGroup, setExportGroup] = useState(''),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('newest'),
    [grid, setGrid] = useState(false);
  const [page, setPage] = useState(0),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [collectionError, setCollectionError] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const cancelled = useRef(false),
    live = useRef(true),
    tabId = useRef<number | undefined>(undefined);
  const current = /\/products\/([^/?#]+)/.exec(new URL(url).pathname)?.[1];
  async function send(action: Record<string, unknown>) {
    const response = await chrome.runtime.sendMessage(action);
    if (!response?.ok) throw Error(response?.error?.code ?? 'SOURCE_UNAVAILABLE');
    return response.data;
  }
  async function target() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || tab.url !== url) throw Error('SOURCE_CHANGED');
    tabId.current = tab.id;
    return tab.id;
  }
  async function read(
    page: number,
    collection: string,
    kind: 'products' | 'collections' = 'products',
  ): Promise<CatalogResult> {
    return send({ action: 'catalog', tabId: await target(), page, collection, kind });
  }
  async function load(reset: boolean, group = filter) {
    if (reset) {
      setItems([]);
      setPage(0);
      setMore(false);
    }
    setLoading(true);
    setMessage('');
    try {
      const next = reset ? 1 : page + 1;
      const result = await read(next, group);
      if (!live.current) return;
      setItems((previous) =>
        reset
          ? result.items
          : [
              ...new Map(
                [...previous, ...result.items].map((item) => [item.handle, item]),
              ).values(),
            ],
      );
      setPage(next);
      setMore(result.more);
    } catch {
      if (live.current) setMessage(t.failed);
    } finally {
      if (live.current) setLoading(false);
    }
  }
  async function groups() {
    const all: { handle: string; title: string }[] = [];
    try {
      for (let p = 1; p <= 20; p++) {
        const result = await read(p, '', 'collections');
        all.push(...result.collections);
        if (!result.collectionsMore) {
          if (live.current) {
            setCollections([...new Map(all.map((c) => [c.handle, c])).values()]);
            setCollectionError(false);
          }
          return;
        }
      }
      throw Error();
    } catch {
      if (live.current) setCollectionError(true);
    }
  }
  useEffect(() => {
    live.current = true;
    void load(true);
    void groups();
    return () => {
      live.current = false;
      cancelled.current = true;
    };
  }, []);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const result = items.filter((p) =>
      [p.title, p.vendor, p.type].some((v) => v.toLocaleLowerCase().includes(q)),
    );
    return result.sort((a, b) => {
      if (sort === 'normal') return 0;
      if (sort === 'low' || sort === 'high') {
        if (a.price === null) return b.price === null ? 0 : 1;
        if (b.price === null) return -1;
        return (Number(a.price) - Number(b.price)) * (sort === 'low' ? 1 : -1);
      }
      const ad = Date.parse(a.created ?? ''),
        bd = Date.parse(b.created ?? '');
      if (!Number.isFinite(ad)) return Number.isFinite(bd) ? 1 : 0;
      if (!Number.isFinite(bd)) return -1;
      return (ad - bd) * (sort === 'newest' ? -1 : 1);
    });
  }, [items, query, sort]);
  async function exportItems(handles?: string[], group = '') {
    setBusy(true);
    setMessage(t.loading);
    cancelled.current = false;
    try {
      const id = await target();
      if (!(await chrome.permissions.request({ origins: [new URL(url).origin + '/*'] })))
        throw Error();
      let wanted = handles;
      if (!wanted) {
        const found = new Set<string>();
        for (let p = 1; p <= 201; p++) {
          if (cancelled.current || !live.current) return;
          const result = await read(p, group);
          const before = found.size;
          for (const item of result.items) found.add(item.handle);
          if (found.size > 1000) throw Error('EXPORT_LIMIT');
          if (!result.more) break;
          if (p === 201 || found.size === before) throw Error('EXPORT_LIMIT');
        }
        wanted = [...found];
      }
      if (!wanted.length) throw Error();
      if (wanted.length > 1000) throw Error('EXPORT_LIMIT');
      const products: SourceProduct[] = [];
      for (let i = 0; i < wanted.length; i += 10) {
        if (cancelled.current || !live.current) return;
        setMessage(t.progress + ' ' + i + ' / ' + wanted.length);
        const result = await send({
          action: 'collectSelected',
          tabId: id,
          handles: wanted.slice(i, i + 10),
        });
        products.push(...result.products);
      }
      if (cancelled.current || !live.current) return;
      if (new Set(products.map((p) => p.currency)).size !== 1) throw Error('CURRENCY_CHANGED');
      await target();
      await send({ action: 'downloadCollectionCsv', products });
      setMessage(t.done);
    } catch (error) {
      if (live.current && !cancelled.current)
        setMessage(error instanceof Error && error.message === 'EXPORT_LIMIT' ? t.limit : t.failed);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  function cancel() {
    cancelled.current = true;
    setMessage('');
    if (tabId.current !== undefined)
      void send({ action: 'cancelCollect', tabId: tabId.current }).catch(() => undefined);
  }
  const date = (value: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleDateString(locale)
      : t.unknown;
  return (
    <section className="catalog-panel">
      <h1>{t.title}</h1>
      <div className="catalog-card">
        <div className="catalog-actions">
          <button
            disabled={busy || !current}
            title={!current ? t.noCurrent : undefined}
            onClick={() => void exportItems([decodeURIComponent(current!)])}
          >
            ↓ {t.current}
          </button>
          <button className="catalog-secondary" disabled={busy} onClick={() => void exportItems()}>
            ↓ {t.all}
          </button>
        </div>
        <div className="catalog-divider" />
        <h3>{t.by}</h3>
        <div className="catalog-actions">
          <select
            aria-label={t.by}
            value={exportGroup}
            disabled={busy}
            onChange={(e) => setExportGroup(e.target.value)}
          >
            <option value="">{t.choose}</option>
            {collections.map((c) => (
              <option key={c.handle} value={c.handle}>
                {c.title}
              </option>
            ))}
          </select>
          <button
            className="catalog-secondary"
            disabled={busy || !exportGroup}
            onClick={() => void exportItems(undefined, exportGroup)}
          >
            ↓ {t.exportCollection}
          </button>
        </div>
        {collectionError && (
          <button className="catalog-text" onClick={() => void groups()}>
            {t.collectionError}
          </button>
        )}
      </div>
      <div className="catalog-card">
        <div className="catalog-heading">
          <h3>{t.searchTitle}</h3>
          <div className="catalog-views">
            <button aria-label={t.grid} aria-pressed={grid} onClick={() => setGrid(true)}>
              ▦
            </button>
            <button aria-label={t.list} aria-pressed={!grid} onClick={() => setGrid(false)}>
              ☰
            </button>
          </div>
        </div>
        <input
          type="search"
          aria-label={t.searchTitle}
          placeholder={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="catalog-actions">
          <select
            aria-label={t.allCollections}
            value={filter}
            disabled={loading || busy}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected([]);
              void load(true, e.target.value);
            }}
          >
            <option value="">{t.allCollections}</option>
            {collections.map((c) => (
              <option key={c.handle} value={c.handle}>
                {c.title}
              </option>
            ))}
          </select>
          <select aria-label={t.sort} value={sort} onChange={(e) => setSort(e.target.value)}>
            {(['normal', 'newest', 'oldest', 'low', 'high'] as const).map((key) => (
              <option key={key} value={key}>
                {t[key]}
              </option>
            ))}
          </select>
        </div>
        <p className="catalog-count">
          {t.loaded} {items.length}
          {more ? ' +' : ''} · {t.shown} {filtered.length}
        </p>
        <small>{t.scope}</small>
      </div>
      <div className="catalog-heading">
        <button className="catalog-text" disabled={loading || busy} onClick={() => void load(true)}>
          {t.refresh}
        </button>
        {selected.length > 0 && (
          <button disabled={busy} onClick={() => void exportItems(selected)}>
            {t.selected} ({selected.length})
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="catalog-status">
          {message}
        </p>
      )}
      {busy && (
        <button className="catalog-secondary" onClick={cancel}>
          {t.cancel}
        </button>
      )}
      {loading && <p role="status">{t.loading}</p>}
      {!loading && !items.length && message && (
        <button
          onClick={() =>
            void (async () => {
              if (await chrome.permissions.request({ origins: [new URL(url).origin + '/*'] })) {
                void load(true);
                void groups();
              }
            })()
          }
        >
          {t.permission}
        </button>
      )}
      <div className={'catalog-items ' + (grid ? 'catalog-grid' : 'catalog-list')}>
        {filtered.map((item) => (
          <article className="catalog-product" key={item.handle}>
            <div className="catalog-image">
              {item.image ? <img src={item.image} alt="" loading="lazy" /> : <span>□</span>}
              <input
                type="checkbox"
                aria-label={item.title}
                checked={selected.includes(item.handle)}
                disabled={busy}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, item.handle]
                      : prev.filter((h) => h !== item.handle),
                  )
                }
              />
            </div>
            <div className="catalog-info">
              <h3 title={item.title}>{item.title}</h3>
              <p>
                {t.price}: <b>{item.price ?? t.unknown}</b>
              </p>
              <p>
                {t.created}: {date(item.created)}
              </p>
            </div>
            <div className="catalog-product-actions">
              <a href={item.url} target="_blank" rel="noreferrer">
                {t.details}
              </a>
              <button disabled={busy} onClick={() => void exportItems([item.handle])}>
                ↓ {t.export}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!loading && !filtered.length && <p>{t.empty}</p>}
      {more && (
        <button
          className="catalog-more"
          disabled={loading || busy}
          onClick={() => void load(false)}
        >
          {t.load}
        </button>
      )}
    </section>
  );
}
