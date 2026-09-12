export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    readonly requestId = '',
  ) {
    super(code);
  }
}
export async function adminApi(path: string, body?: unknown, method = 'POST') {
  let csrf = '';
  if (body !== undefined) {
    const r = await fetch('/api/v1/auth/csrf', { cache: 'no-store' }),
      v = await r.json();
    if (!r.ok) throw new ApiFailure(v.error?.code ?? 'UNKNOWN', v.requestId ?? '');
    csrf = v.data.csrfToken;
  }
  const r = await fetch('/api/v1' + path, {
      method: body === undefined ? 'GET' : method,
      cache: 'no-store',
      headers:
        body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    v = await r.json();
  if (!r.ok) throw new ApiFailure(v.error?.code ?? 'UNKNOWN', v.requestId ?? '');
  return v.data;
}
