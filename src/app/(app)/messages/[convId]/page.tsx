
"use client";

import { ConversationScreen } from "@/components/ConversationScreen";
import { useParams } from 'next/navigation';

export default function ConversationPage() {
    const params = useParams();
    const conversationId = params?.convId as string;
    
    
    return <ConversationScreen conversationId={conversationId} />;
}
