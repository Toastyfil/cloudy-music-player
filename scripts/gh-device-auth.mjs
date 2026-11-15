#!/usr/bin/env node
// Minimal GitHub device-flow login, used when `gh auth refresh` refuses because
// the browser account differs from the account gh has stored.
//
//   node scripts/gh-device-auth.mjs workflow repo
//
// Prints a one-time code and the verification URL, then waits until the code is
// approved and writes the token to scripts/.gh-device-token (git-ignored).
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_ID = 'Iv1.b507a08c87ecfe98'; // GitHub CLI's public OAuth client
const scopes = process.argv.slice(2).join(' ') || 'repo workflow';
const outFile = path.join(process.cwd(), 'scripts', '.gh-device-token');

const post = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
};

const start = await post('https://github.com/login/device/code', { client_id: CLIENT_ID, scope: scopes });
if (!start.device_code) {
  console.error('Could not start device flow:', start);
  process.exit(1);
}

console.log(`CODE ${start.user_code}`);
console.log(`URL ${start.verification_uri}?user_code=${start.user_code}`);

let interval = Math.max(5, start.interval ?? 5) * 1000;
const deadline = Date.now() + (start.expires_in ?? 900) * 1000;

while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, interval));
  const poll = await post('https://github.com/login/oauth/access_token', {
    client_id: CLIENT_ID,
    device_code: start.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (poll.access_token) {
    fs.writeFileSync(outFile, poll.access_token, { mode: 0o600 });
    console.log('TOKEN_READY');
    process.exit(0);
  }
  if (poll.error === 'authorization_pending') continue;
  if (poll.error === 'slow_down') {
    interval += 5000;
    continue;
  }
  console.error('Device flow failed:', poll.error, poll.error_description ?? '');
  process.exit(1);
}
console.error('Device code expired before it was approved.');
process.exit(1);
