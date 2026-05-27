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

  const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?grant_type=refresh_token&client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}`;
  
  try {
    const res = await fetch(tokenUrl, { method: 'POST' });
    const data = await res.json();
    console.log('Refresh Response:', data);

    if (data.access_token) {
      console.log('Got access token, trying to create test ticket...');
      const orgId = envMap['ZOHO_ORG_ID'];
      
      const ticketPayload = {
        subject: 'Test Dispute from Scratch Script',
        description: 'Test description',
        channel: 'Web',
        departmentId: "1369927000000006907" // If needed
      };

      const ticketRes = await fetch('https://desk.zoho.com/api/v1/tickets', {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${data.access_token}`,
          'orgId': orgId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(ticketPayload)
      });
      console.log('Ticket Create Status:', ticketRes.status);
      console.log('Ticket Create Body:', await ticketRes.text());
    }
  } catch (e) {
    console.error('Error:', e);
  }
}

test();
