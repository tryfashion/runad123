import { z } from 'zod';
export const normalizeThemeName = (name: string) =>
  name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const themeUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash;
  });
export const themeLinkSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(250),
  aliases: z.array(z.string().trim().min(1).max(250)).max(20),
  url: themeUrlSchema,
  enabled: z.boolean(),
});
export const themeLinkListSchema = z
  .array(themeLinkSchema)
  .max(100)
  .superRefine((items, context) => {
    const names = new Set<string>(),
      ids = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id)) context.addIssue({ code: 'custom', message: 'Duplicate ID' });
      ids.add(item.id);
      for (const name of new Set([item.name, ...item.aliases].map(normalizeThemeName))) {
        if (names.has(name)) context.addIssue({ code: 'custom', message: 'Ambiguous theme alias' });
        names.add(name);
      }
    }
  });
export const themeLinksConfigSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  items: themeLinkListSchema,
});
export const themeLookupQuerySchema = z.strictObject({ name: z.string().trim().min(1).max(250) });
export const themeLookupSchema = z.strictObject({
  link: z.object({ name: z.string().max(250), url: themeUrlSchema }).nullable(),
});
export type ThemeLink = z.infer<typeof themeLinkSchema>;

const themeWords = {
  title: ['主题返利链接', '主題返利連結', 'Theme affiliate links'],
  name: ['主题名称', '主題名稱', 'Theme name'],
  aliases: ['匹配别名（每行一个）', '比對別名（每行一個）', 'Matching aliases (one per line)'],
  url: ['返利网址（HTTPS）', '返利網址（HTTPS）', 'Affiliate URL (HTTPS)'],
  enabled: ['启用', '啟用', 'Enabled'],
  add: ['添加主题', '新增主題', 'Add theme'],
  remove: ['删除', '刪除', 'Remove'],
  save: ['保存主题链接', '儲存主題連結', 'Save theme links'],
  reload: ['重新加载配置', '重新載入設定', 'Reload configuration'],
  saved: ['主题链接已保存', '主題連結已儲存', 'Theme links saved'],
  invalid: [
    '请检查网址、主题名称和重复别名。',
    '請檢查網址、主題名稱及重複別名。',
    'Check URLs, theme names and duplicate aliases.',
  ],
  hint: [
    '按主题名称或别名精确匹配，忽略大小写和多余空格。版本名称可添加为别名。',
    '依主題名稱或別名精確比對，忽略大小寫和多餘空格。版本名稱可新增為別名。',
    'Exact name or alias matching, ignoring case and extra spaces. Add versioned names as aliases.',
  ],
  affiliate: ['推广链接', '推廣連結', 'Affiliate link'],
  disclosure: [
    '通过此链接购买，我们可能获得佣金。',
    '透過此連結購買，我們可能獲得佣金。',
    'We may earn a commission if you buy through this link.',
  ],
} as const;
export function themeText(locale: 'zh-Hans' | 'zh-Hant' | 'en', key: keyof typeof themeWords) {
  return themeWords[key][locale === 'zh-Hans' ? 0 : locale === 'zh-Hant' ? 1 : 2];
}
