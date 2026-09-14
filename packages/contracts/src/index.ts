export * from './member-i18n.js';
export * from './member.js';
export * from './domain-registration.js';
import { z } from 'zod';

export const uiLocaleSchema = z.enum(['zh-Hans', 'zh-Hant', 'en']);
export const uiPreferenceSchema = z.enum(['auto', 'zh-Hans', 'zh-Hant', 'en']);
export const contentLanguageSchema = z.enum(['preserve', 'zh-Hans', 'zh-Hant', 'en']);
export const accessModeSchema = z.enum(['anonymous_allowed', 'login_required']);
export const protocolVersion = 1;

export * from './ai-management.js';
export * from './ai-management-i18n.js';
