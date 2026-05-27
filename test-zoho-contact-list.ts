import fs from 'fs';

async function test() {
  const env = fs.readFileSync('.env.local', 'utf-8');
  const envMap: Record<string, string> = {};
  env.split('\n').forEach(line => {
    if (line.includes('=')) {
      const [key, ...val] = line.split('=');
      envMap[key.trim()] = val.join('=').trim();
    }
  });

  const clientId = envMap['ZOHO_CLIENT_ID'];
  const clientSecret = envMap['ZOHO_CLIENT_SECRET'];
  const refreshToken = envMap['ZOHO_REFRESH_TOKEN'];
  const orgId = envMap['ZOHO_ORG_ID'];

  const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}`;
  
  try {
    const res = await fetch(tokenUrl, { method: 'POST' });
    const data = await res.json();
    const accessToken = data.access_token;
    
    if (accessToken) {
      const email = 'test@example.com';
      const url = `https://desk.zoho.com/api/v1/contacts?email=${encodeURIComponent(email)}`;
      const getRes = await fetch(url, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'orgId': orgId
        }
      });
      
      console.log('List Status:', getRes.status);
      const searchData = await getRes.json();
      console.log('List Data:', JSON.stringify(searchData));
    }
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
