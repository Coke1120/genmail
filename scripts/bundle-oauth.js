import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseGoogleOAuth } from '../server/oauth-client.js';

export function bundleOAuth(backend, env = process.env) {
  if (env.MORROW_GOOGLE_OAUTH_FILE && env.MORROW_GOOGLE_OAUTH_JSON) throw new Error('Choose one Google OAuth build input.');
  let source = env.MORROW_GOOGLE_OAUTH_JSON;
  if (env.MORROW_GOOGLE_OAUTH_FILE) {
    try { source = readFileSync(env.MORROW_GOOGLE_OAUTH_FILE, 'utf8'); }
    catch { throw new Error('Could not read the Google OAuth build input.'); }
  }
  if (!source) {
    if (env.MORROW_REQUIRE_GOOGLE_OAUTH === '1') throw new Error('This release requires a Google Desktop OAuth build input.');
    rmSync(join(backend, 'google-oauth.json'), { force: true });
    return false;
  }
  const { clientId, clientSecret } = parseGoogleOAuth(source);
  // Installed-app credentials identify the app and are extractable from a desktop
  // package. Never put user tokens or a confidential web-client secret here.
  writeFileSync(join(backend, 'google-oauth.json'), JSON.stringify({ installed: { client_id: clientId, client_secret: clientSecret } }), { mode: 0o644 });
  return true;
}
