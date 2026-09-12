import nodemailer from 'nodemailer';
import type { UiLocale } from '@runad123/contracts/i18n';
import { ServiceError } from './security.js';

export interface LoginMail {
  email: string;
  code: string;
  locale: UiLocale;
}
export interface Mailer {
  kind: 'smtp' | 'memory' | 'disabled';
  send(mail: LoginMail): Promise<void>;
  verify(): Promise<boolean>;
}
export function mailText(mail: LoginMail) {
  const messages = {
    en: [
      'Your runad123 sign-in code',
      `Your code: ${mail.code}\nExpires in 10 minutes. If you did not request it, ignore this email.`,
    ],
    'zh-Hans': [
      'runad123 登录验证码',
      `验证码：${mail.code}\n10 分钟内有效。如非本人操作，请忽略此邮件。`,
    ],
    'zh-Hant': [
      'runad123 登入驗證碼',
      `驗證碼：${mail.code}\n10 分鐘內有效。如非本人操作，請忽略此郵件。`,
    ],
  };
  const [subject, text] = messages[mail.locale];
  return { subject, text };
}
export const disabledMailer: Mailer = {
  kind: 'disabled',
  async send() {
    throw new ServiceError('EMAIL_UNAVAILABLE', 503);
  },
  async verify() {
    return false;
  },
};
// Test/development adapter keeps codes only in process memory, never logs or serves an inbox endpoint.
export function createMemoryMailer(environment: string) {
  if (!['development', 'test'].includes(environment)) throw new Error('MEMORY_MAIL_FORBIDDEN');
  const outbox: LoginMail[] = [];
  return {
    kind: 'memory' as const,
    outbox,
    async send(mail: LoginMail) {
      outbox.push(mail);
      if (outbox.length > 100) outbox.shift();
    },
    async verify() {
      return true;
    },
  };
}
export function createSmtpMailer(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}): Mailer {
  const options = {
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: true,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
    dnsTimeout: 8000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
  async function run<T>(
    operation: (transport: ReturnType<typeof nodemailer.createTransport>) => Promise<T>,
  ): Promise<T> {
    const transport = nodemailer.createTransport({
      ...options,
      pool: true,
      maxConnections: 1,
      maxMessages: 1,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            transport.close();
            reject(new ServiceError('EMAIL_UNAVAILABLE', 503));
          }, 10000);
        }),
      ]);
    } catch {
      throw new ServiceError('EMAIL_UNAVAILABLE', 503);
    } finally {
      if (timer) clearTimeout(timer);
      transport.close();
    }
  }
  return {
    kind: 'smtp',
    async send(mail) {
      await run(async (transport) => {
        const info = await transport.sendMail({
          from: config.from,
          to: mail.email,
          ...mailText(mail),
        });
        if (!info.accepted?.length) throw new ServiceError('EMAIL_UNAVAILABLE', 503);
      });
    },
    async verify() {
      try {
        return await run((t) => t.verify());
      } catch {
        return false;
      }
    },
  };
}
