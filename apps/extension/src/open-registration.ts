import type { UiLocale } from '@runad123/contracts/i18n';
export async function openRegistrationWindow(locale: UiLocale) {
  const reply = await chrome.runtime.sendMessage({ action: 'openRegistration', locale });
  if (!reply?.ok) throw Error(reply?.error?.code ?? 'UNKNOWN');
}
