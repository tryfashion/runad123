export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    { data: { status: 'alive', stage: 'M0' }, requestId: crypto.randomUUID() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
