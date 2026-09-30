export const dynamic = 'force-dynamic';

interface ThreadPageProps {
  params: Promise<{
    threadId: string;
  }>;
}

/**
 * Thread page — ChatContainer is rendered by the (chat) layout.
 *
 * Keep a tiny route marker in the page tree so App Router treats thread-id
 * changes as a real navigation instead of a no-op against an identical tree.
 */
export default async function ThreadPage(props: ThreadPageProps) {
  const params = await props.params;
  return <span hidden aria-hidden="true" data-thread-route={params.threadId} />;
}
