import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.NODE_ENV === 'production' 
    ? 'https://app.yrdly.ng/api/auth/zoho/callback' 
    : 'http://localhost:9002/api/auth/zoho/callback';
  
  // Scopes needed for Desk
  const scopes = 'Desk.tickets.CREATE,Desk.tickets.READ,Desk.tickets.UPDATE,Desk.contacts.READ,Desk.contacts.CREATE';
  
  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=${scopes}&client_id=${clientId}&response_type=code&access_type=offline&redirect_uri=${redirectUri}&prompt=consent`;

  return NextResponse.redirect(authUrl);
}
