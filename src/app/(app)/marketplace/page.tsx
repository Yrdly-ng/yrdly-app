
"use client";

import { MarketplaceScreen } from "@/components/MarketplaceScreen";
import { useMarketplaceActions } from "@/hooks/use-marketplace-actions";

export default function MarketplacePage() {
  const { handleItemClick, handleMessageSeller } = useMarketplaceActions();

  return (
    <MarketplaceScreen
      onItemClick={handleItemClick}
      onMessageSeller={handleMessageSeller}
    />
  );
}
