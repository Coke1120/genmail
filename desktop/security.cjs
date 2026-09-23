const SIGN_IN = /^\/api\/(?:oauth|calendar-oauth)\/(?:google|microsoft)\/authorize$/;
function isSignInURL(value, origin) {
  try {
    const url = new URL(value), local = new URL(origin);
    return url.protocol === 'http:' && url.hostname === 'localhost' && url.port === local.port && SIGN_IN.test(url.pathname) && /^[A-Za-z0-9_-]{16,256}$/.test(url.searchParams.get('state') || '') && [...url.searchParams.keys()].every(key => key === 'state') && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function isExternalURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
module.exports = { isSignInURL, isExternalURL };
