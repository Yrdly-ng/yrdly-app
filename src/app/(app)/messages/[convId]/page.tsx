
"use client";

import { MessagesScreen } from "@/components/MessagesScreen";
import { useParams } from 'next/navigation';

export default function ConversationPage() {
    const params = useParams();
    const conversationId = params?.convId as string;
    
    return <MessagesScreen initialConvId={conversationId} />;
}
