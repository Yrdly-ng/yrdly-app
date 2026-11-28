const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('legacy alert reads expose only the fields used by public alert UI', () => {
  const service = fs.readFileSync('src/lib/notifications/alert-service.ts', 'utf8');
  const detail = fs.readFileSync('src/app/(app)/alerts/[alertId]/page.tsx', 'utf8');

  assert.doesNotMatch(service, /\.from\("alerts"\)\s*\.select\("\*"\)/);
  assert.doesNotMatch(detail, /\.from\("alerts"\)\s*\.select\("\*"\)/);
  assert.doesNotMatch(service, /contact_info|subject_name|subject_age|subject_photo_url/);
  assert.doesNotMatch(detail, /contact_info|subject_name|subject_age|subject_photo_url/);
  assert.match(service, /last_seen_address, source, is_resolved, created_at, expires_at/);
});

test('legacy alert resolution is authenticated and authorized server-side', () => {
  const service = fs.readFileSync('src/lib/notifications/alert-service.ts', 'utf8');
  const endpoint = fs.readFileSync('src/app/api/alerts/resolve/route.ts', 'utf8');

  assert.match(service, /authenticatedFetch\("\/api\/alerts\/resolve"/);
  assert.doesNotMatch(service, /\.from\("alerts"\)\s*\.update/);
  assert.match(endpoint, /getAuthenticatedUser\(request\)/);
  assert.match(endpoint, /\.from\('users'\)[\s\S]*?\.select\('is_admin'\)/);
  assert.match(endpoint, /\.from\('alerts'\)[\s\S]*?\.update/);
  assert.match(endpoint, /status: 403/);
});
