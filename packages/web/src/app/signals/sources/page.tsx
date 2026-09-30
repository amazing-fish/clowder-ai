import { SignalSourcesView } from '@/components/signals/SignalSourcesView';

export default async function SignalSourcesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const from = typeof searchParams.from === 'string' ? searchParams.from : null;
  return <SignalSourcesView initialReferrerThread={from} />;
}
