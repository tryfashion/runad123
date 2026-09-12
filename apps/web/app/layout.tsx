import '@ant-design/v5-patch-for-react-19';
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import { parseAcceptLanguage, parsePreference, resolveLocale } from '@runad123/contracts/i18n';
import 'antd/dist/reset.css';
import './styles.css';

export const metadata = { title: 'runad123', description: 'Shopify product preparation workspace' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const header = await headers();
  const locale = resolveLocale(
    parsePreference(jar.get('uiPreference')?.value),
    parseAcceptLanguage(header.get('accept-language')),
  );
  const antdLocale = locale === 'zh-Hant' ? zhTW : locale === 'en' ? enUS : zhCN;
  return (
    <html lang={locale}>
      <body>
        <AntdRegistry>
          <ConfigProvider
            locale={antdLocale}
            theme={{
              token: {
                colorPrimary: '#2563eb',
                colorInfo: '#2563eb',
                colorSuccess: '#16a34a',
                colorWarning: '#f59e0b',
                colorError: '#dc2626',
                borderRadius: 10,
                fontFamily: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif",
              },
              components: {
                Layout: {
                  siderBg: '#ffffff',
                  headerBg: '#ffffff',
                  bodyBg: '#f5f7fb',
                },
                Menu: {
                  itemSelectedBg: '#eaf2ff',
                  itemSelectedColor: '#2563eb',
                  itemHoverBg: '#f1f5f9',
                  itemHoverColor: '#1d4ed8',
                  itemColor: '#475569',
                },
                Card: {
                  headerFontSize: 16,
                },
              },
            }}
          >
            {children}
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
