import { MemoryHub } from '@/components/memory/MemoryHub';

export default async function MemoryHealthPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const from = typeof searchParams.from === 'string' ? searchParams.from : null;
  return <MemoryHub activeTab="health" initialReferrerThread={from} />;
}
