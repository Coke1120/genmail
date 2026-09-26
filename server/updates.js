import { readFileSync } from 'node:fs';

export const currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const repository = 'https://github.com/Coke1120/Morrow-Mail';

function version(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  if (!match) return null;
  const pre = match[4]?.split('.') || [];
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null;
  return { core: match.slice(1, 4).map(BigInt), pre };
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export async function checkUpdates({ includePrereleases = false, installed = currentVersion, fetchImpl = fetch } = {}) {
  const local = version(installed);
  if (!local) throw Object.assign(new Error('The installed version is not recognized.'), { status: 502 });
  let releases;
  try {
    const response = await fetchImpl('https://api.github.com/repos/Coke1120/Morrow-Mail/releases?per_page=100', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Morrow-Mail-update-check' },
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if ([403, 429].includes(response.status)) throw Object.assign(new Error('GitHub temporarily limited update checks. Try again later.'), { status: 503 });
    if (!response.ok) throw new Error('GitHub request failed');
    releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Invalid release response');
  } catch (error) {
    if (error.status === 503) throw error;
    throw Object.assign(new Error('Could not check GitHub for updates. Check your connection and try again.'), { status: 502 });
  }
  const latest = releases.filter(item => item && !item.draft).map(item => ({ item, parsed: version(item.tag_name) }))
    .filter(({ item, parsed }) => parsed && (includePrereleases || (!item.prerelease && !parsed.pre.length)))
    .sort((a, b) => compare(b.parsed, a.parsed))[0];
  if (!latest) throw Object.assign(new Error('No published releases were found for this channel. Try including alpha and beta releases.'), { status: 404 });
  return {
    currentVersion: installed, latestVersion: latest.item.tag_name.replace(/^v/, ''),
    updateAvailable: compare(latest.parsed, local) > 0, prerelease: !!latest.item.prerelease || !!latest.parsed.pre.length,
    url: `${repository}/releases/tag/${encodeURIComponent(latest.item.tag_name)}`, checkedAt: new Date().toISOString(),
  };
}
