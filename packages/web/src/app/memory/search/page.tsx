import { MemoryHub } from '@/components/memory/MemoryHub';

export default async function MemorySearchPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const q = typeof searchParams.q === 'string' ? searchParams.q : '';
  const from = typeof searchParams.from === 'string' ? searchParams.from : null;
  return <MemoryHub activeTab="search" initialQuery={q} initialReferrerThread={from} />;
}
