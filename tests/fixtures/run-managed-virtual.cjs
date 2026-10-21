const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync('tests/fixtures/managed-virtual-schema.sql', 'utf8'));
    if (!process.argv.includes('--red')) {
      await db.exec(readFileSync('supabase/migrations/20261020231643_managed_virtual_accounts.sql', 'utf8'));
    }
    await db.exec(readFileSync('tests/fixtures/managed-virtual-accounts.sql', 'utf8'));
    console.log('PASS: managed virtual database integration checks');
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.message);
  if (error.position && error.query) console.error(error.query.slice(Math.max(0, Number(error.position)-200), Number(error.position)+100));
  if (error.where) console.error(error.where);
  process.exitCode = 1;
});
