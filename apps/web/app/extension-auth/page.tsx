import { RegistrationPage } from './registration-page';
import { uiLocaleSchema } from '@runad123/contracts';
export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <RegistrationPage
      extension={typeof params.extension === 'string' ? params.extension : ''}
      flow={typeof params.flow === 'string' ? params.flow : ''}
      locale={uiLocaleSchema.catch('zh-Hans').parse(params.lang)}
    />
  );
}
