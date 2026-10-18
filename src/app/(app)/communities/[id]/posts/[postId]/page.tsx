'use client';
import {useParams} from 'next/navigation';
import {CommunityWorkspace} from '@/components/communities/CommunityWorkspace';
export default function CommunityPostPage(){const {id,postId}=useParams<{id:string;postId:string}>();return <CommunityWorkspace id={id} postId={postId}/>;}
