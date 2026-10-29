export type ConversationKind = 'friend' | 'marketplace' | 'briefcase' | 'event';

type ConversationContext = {
  type?: string;
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
    return conversation.item_id ? `/events/${encodeURIComponent(conversation.item_id)}` : null;
  }
  if (conversation.business_id) return `/businesses/${encodeURIComponent(conversation.business_id)}`;
  return conversation.item_id ? `/marketplace/${encodeURIComponent(conversation.item_id)}` : null;
}
