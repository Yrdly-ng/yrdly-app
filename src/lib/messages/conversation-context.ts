export type ConversationKind = 'friend' | 'marketplace' | 'briefcase' | 'event';

type ConversationContext = {
  type?: string;
  context?: { event_id?: string; catalog_item_id?: string; catalog_item_business_id?: string } | null;
  item_id?: string | null;
  business_id?: string | null;
};

export function getConversationType(conversation: ConversationContext): ConversationKind {
  if (conversation.type === 'event') return 'event';
  if (conversation.type === 'briefcase' || conversation.type === 'business' || conversation.business_id) return 'briefcase';
  if (conversation.type === 'marketplace' || conversation.item_id) return 'marketplace';
  return 'friend';
}

export function getConversationContextHref(conversation: ConversationContext): string | null {
  if (conversation.type === 'event') {
    const id = conversation.context?.event_id || conversation.item_id;
    return id ? `/events/${encodeURIComponent(id)}` : null;
  }
  if (conversation.context?.catalog_item_id && conversation.business_id) return `/businesses/${encodeURIComponent(conversation.business_id)}/catalog/${encodeURIComponent(conversation.context.catalog_item_id)}`;
  if (conversation.business_id) return `/businesses/${encodeURIComponent(conversation.business_id)}`;
  return conversation.item_id ? `/marketplace/${encodeURIComponent(conversation.item_id)}` : null;
}
