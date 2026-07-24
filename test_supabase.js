import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  const { data, error } = await supabase
    .from('escrow_transactions')
    .select('id, seller_id, seller:users!escrow_transactions_seller_id_fkey(id, name, avatar_url), item:posts(id, title, image_urls)')
    .limit(1)
  console.log('Error:', error)
  console.log('Data:', JSON.stringify(data, null, 2))
}

test()
