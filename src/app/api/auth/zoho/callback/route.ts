import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const redirectUri = process.env.NODE_ENV === 'production' 
    ? 'https://app.yrdly.ng/api/auth/zoho/callback' 
    : 'http://localhost:9002/api/auth/zoho/callback';

  try {
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?grant_type=authorization_code&client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${redirectUri}&code=${code}`;
    
    const response = await fetch(tokenUrl, {
      method: 'POST',
    });

    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    return NextResponse.json({
      message: 'Success! Copy the refresh token below and add it to your .env.local file as ZOHO_REFRESH_TOKEN',
      refresh_token: data.refresh_token,
      access_token_for_now: data.access_token,
      expires_in: data.expires_in,
    });

  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to exchange code for token', details: err.message }, { status: 500 });
  }
}
