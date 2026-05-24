const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'public', 'sw.js');

// Use Vercel's commit SHA (short) so each deploy gets a new cache; fallback to timestamp for local
const version =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  `local-${Date.now()}`;

let content = fs.readFileSync(swPath, 'utf8');

// Match const CACHE_VERSION = 'anything';
const regex = /const CACHE_VERSION = '.*';/;

if (!regex.test(content)) {
  console.warn('inject-sw-version: CACHE_VERSION variable not found in sw.js, skipping');
  process.exit(0);
}

content = content.replace(regex, `const CACHE_VERSION = '${version}';`);
fs.writeFileSync(swPath, content);
console.log('inject-sw-version: set cache version to', version);
