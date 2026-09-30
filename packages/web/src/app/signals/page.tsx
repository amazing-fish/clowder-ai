import { Suspense } from 'react';
import { SignalInboxView } from '@/components/signals/SignalInboxView';

export default async function SignalsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const from = typeof searchParams.from === 'string' ? searchParams.from : null;
  return (
    <Suspense>
      <SignalInboxView initialReferrerThread={from} />
    </Suspense>
  );
}
