const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const emails = ['ggomomehn@gmail.com', 'feranmioyelowo@gmail.com', 'vickysalami04@gmail.com'];
  
  for (const email of emails) {
    const { data: user, error: findError } = await supabase.from('users').select('id, email').eq('email', email).single();
    if (findError) {
      console.error(`Error finding user ${email}:`, findError.message);
      continue;
    }
    
    if (user) {
      console.log(`Found user ${email} (${user.id}). Updating...`);
      const { error: updateError } = await supabase.from('users').update({
        verified: true,
        verified_seller: true
      }).eq('id', user.id);
      
      if (updateError) {
        console.error(`Failed to update ${email}:`, updateError.message);
      } else {
        console.log(`Successfully verified ${email}!`);
      }
    }
  }
}

main().catch(console.error);
