import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export class ServiceError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details?: Record<string, string | number>,
  ) {
    super(code);
  }
}
export const digest = (value: string) => createHash('sha256').update(value).digest();
export const secretToken = () => randomBytes(32).toString('base64url');
export const hmac = (secret: string, purpose: string, value: string) =>
  createHmac('sha256', secret).update(`${purpose}\0${value}`).digest();
export function same(a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) {
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
export function validToken(token: string | undefined): token is string {
  return !!token && /^[A-Za-z0-9_-]{43}$/.test(token);
}
