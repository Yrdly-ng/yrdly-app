'use client';
import {useParams} from 'next/navigation';
import {CommunityWorkspace} from '@/components/communities/CommunityWorkspace';
export default function CommunityPage(){const {id}=useParams<{id:string}>();return <CommunityWorkspace id={id}/>;}
