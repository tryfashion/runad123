import { renderWorkspace } from '../render-workspace';
export default function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return renderWorkspace(searchParams, 'tutorials');
}
