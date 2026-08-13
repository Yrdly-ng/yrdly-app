const { createClient } = require('@supabase/supabase-js');

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing supabase env vars");
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Create bucket if not exists
  const { data: buckets, error: getBucketsError } = await supabase.storage.listBuckets();
  if (getBucketsError) throw getBucketsError;
  
  if (!buckets.find(b => b.name === 'bank-logos')) {
    const { data, error } = await supabase.storage.createBucket('bank-logos', { public: true });
    if (error) {
       console.log('Failed to create bucket, perhaps it already exists. Error:', error.message);
    } else {
       console.log('Bucket created.');
    }
  } else {
    console.log('Bucket already exists.');
  }
  
  // ensure public is true
  await supabase.storage.updateBucket('bank-logos', { public: true });

  // 2. Fetch data.json
  const repoDataRes = await fetch("https://raw.githubusercontent.com/supermx1/nigerian-banks-api/main/data.json");
  const repoData = await repoDataRes.json();
  
  const mapping = {};
  const baseUrl = "https://raw.githubusercontent.com/supermx1/nigerian-banks-api/main";
  
  console.log('Uploading logos...');
  let count = 0;
  for (const bank of repoData) {
    if (!bank.logo) continue;
    const imageUrl = `${baseUrl}/${bank.logo}`;
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        console.warn(`Failed to fetch logo for ${bank.code}`);
        continue;
      }
      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      const fileName = bank.logo.split('/').pop();
      
      // Upload to supabase
      const { data, error } = await supabase.storage.from('bank-logos').upload(fileName, buffer, {
        upsert: true,
        contentType: imgRes.headers.get('content-type') || 'image/png',
      });
      
      if (error) {
        console.error(`Failed to upload ${fileName}:`, error.message);
      } else {
        const { data: publicUrlData } = supabase.storage.from('bank-logos').getPublicUrl(fileName);
        mapping[bank.code] = publicUrlData.publicUrl;
        count++;
      }
    } catch (e) {
      console.error(`Error processing ${bank.code}:`, e.message);
    }
  }
  console.log(`Uploaded ${count} logos.`);
  
  // Upload mapping.json
  const mappingBuffer = Buffer.from(JSON.stringify(mapping, null, 2));
  const { error: mappingError } = await supabase.storage.from('bank-logos').upload('mapping.json', mappingBuffer, {
    upsert: true,
    contentType: 'application/json',
  });
  
  if (mappingError) {
    console.error('Failed to upload mapping.json:', mappingError.message);
  } else {
    console.log('Successfully uploaded mapping.json');
    const { data: publicUrlData } = supabase.storage.from('bank-logos').getPublicUrl('mapping.json');
    console.log('Mapping URL:', publicUrlData.publicUrl);
    
    // Spot check
    console.log('Spot checking 3 URLs:');
    const codes = Object.keys(mapping).slice(0, 3);
    for (const code of codes) {
        console.log(`- ${code}: ${mapping[code]}`);
    }
  }
}

run().catch(console.error);
