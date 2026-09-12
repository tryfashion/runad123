export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    {
      error: {
        code: 'SERVICE_NOT_READY',
        message: 'Database and task processing are not implemented in M0.',
        retryable: false,
      },
      requestId: crypto.randomUUID(),
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
