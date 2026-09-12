import { describe, expect, it } from 'vitest';
import {
  dictionaries,
  parseAcceptLanguage,
  parsePreference,
  resolveLocale,
  resolveWebsiteLocale,
} from '../../packages/contracts/src/i18n.js';

describe('language selection', () => {
  it.each([
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hant-CN', 'zh-Hant'],
    ['zh-Hans-HK', 'zh-Hans'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['fr-FR', 'en'],
    ['%%%bad', 'en'],
  ])('resolves %s to %s', (input, expected) =>
    expect(resolveLocale('auto', [input])).toBe(expected),
  );
  it('looks through unsupported candidates before defaulting', () => {
    expect(resolveLocale('auto', ['fr-FR', 'zh-TW'])).toBe('zh-Hant');
    expect(resolveLocale('en', ['zh-TW'])).toBe('en');
  });
  it('respects language weights and exclusions', () => {
    expect(
      resolveLocale('auto', parseAcceptLanguage('en;q=0,fr-FR;q=1,zh-TW;q=0.8,zh-CN;q=0.5')),
    ).toBe('zh-Hant');
    expect(parseAcceptLanguage('zh-TW;q=2,zh-CN;q=oops,en;q=0.5')).toEqual(['en']);
  });
  it('manual preference beats a link and a link does not become a preference', () => {
    expect(resolveWebsiteLocale('zh-Hans', 'en', ['zh-TW'])).toBe('zh-Hans');
    expect(resolveWebsiteLocale('auto', 'en', ['zh-TW'])).toBe('en');
    expect(resolveWebsiteLocale('auto', '../../bad', ['zh-TW'])).toBe('zh-Hant');
    expect(parsePreference('unknown')).toBe('auto');
  });
  it('ships complete, nonempty dictionaries', () => {
    const keys = Object.keys(dictionaries.en).sort();
    for (const dictionary of Object.values(dictionaries)) {
      expect(Object.keys(dictionary).sort()).toEqual(keys);
      expect(Object.values(dictionary).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
});
