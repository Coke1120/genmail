import { existsSync, readFileSync } from 'node:fs';

const bundledFile = new URL('../google-oauth.json', import.meta.url);

export function parseGoogleOAuth(source) {
  try {
    if (typeof source !== 'string' || Buffer.byteLength(source) > 32768) throw new Error();
    const { installed, web } = JSON.parse(source);
    if (web || !installed || typeof installed.client_id !== 'string' || !/^[A-Za-z0-9._-]{1,1000}\.apps\.googleusercontent\.com$/.test(installed.client_id)) throw new Error();
    if (typeof installed.client_secret !== 'string' || !installed.client_secret || installed.client_secret.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(installed.client_secret)) throw new Error();
    return { clientId: installed.client_id, clientSecret: installed.client_secret };
  } catch { throw new Error('Use a valid Google Desktop app OAuth JSON file.'); }
}

export function bundledGoogleOAuth() {
  return existsSync(bundledFile) ? parseGoogleOAuth(readFileSync(bundledFile, 'utf8')) : null;
}

// Select the complete pair; never combine a custom ID with a bundled secret.
export function oauthCredentials(provider, body, googleClient) {
  if (body?.useDefaultClient !== undefined && typeof body.useDefaultClient !== 'boolean') throw Object.assign(new Error('Choose a valid OAuth client option.'), { status: 400 });
  if (!body?.useDefaultClient) return body || {};
  if (provider !== 'google' || !googleClient) throw Object.assign(new Error('Built-in sign-in is not configured for this provider. Use your own OAuth client.'), { status: 400 });
  if (body.clientId || body.clientSecret) throw Object.assign(new Error('Choose either the built-in OAuth client or your own credentials.'), { status: 400 });
  return { ...body, ...googleClient };
}
