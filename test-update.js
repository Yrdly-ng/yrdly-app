import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Just testing the RLS for messages table with anonymous user!
// Oh wait, anon key doesn't have a user session, so RLS will fail for SURE.
// I need the user's session to test it. I can't easily script it without a token.
