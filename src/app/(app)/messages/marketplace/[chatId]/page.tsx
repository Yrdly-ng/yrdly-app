import { Suspense } from 'react';
import { MarketplaceChatPageClient } from './MarketplaceChatPageClient';

// Required for static export compatibility
export async function generateStaticParams() {
  return [];
}

export default async function MarketplaceChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const resolvedParams = await params;
  
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <MarketplaceChatPageClient chatId={resolvedParams.chatId} />
    </Suspense>
  );
}
