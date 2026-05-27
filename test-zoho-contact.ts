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
      console.log('Got access token, trying to search contact...');
      
      const email = 'test@example.com';
      const searchUrl = `https://desk.zoho.com/api/v1/contacts/search?email=${encodeURIComponent(email)}`;
      const searchRes = await fetch(searchUrl, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'orgId': orgId
        }
      });
      
      console.log('Search Status:', searchRes.status);
      const searchData = await searchRes.json();
      console.log('Search Data:', JSON.stringify(searchData));

      if (searchData.data && searchData.data.length > 0) {
        console.log('Contact found:', searchData.data[0].id);
      } else {
        console.log('Creating contact...');
        const createUrl = 'https://desk.zoho.com/api/v1/contacts';
        const createRes = await fetch(createUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'orgId': orgId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            lastName: 'TestUser',
            email: email
          })
        });

        console.log('Create Status:', createRes.status);
        console.log('Create Body:', await createRes.text());
      }
    }
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
