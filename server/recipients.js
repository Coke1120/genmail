// Plain addresses separated by commas or semicolons; reject partial parses.
export function recipients(input, draft = false) {
  const result = {};
  const seen = new Set();
  let count = 0;
  for (const field of ['to', 'cc', 'bcc']) {
    const value = input[field] ?? '';
    if (typeof value !== 'string' || value.length > 26000 || /[\r\n\0]/.test(value)) {
      throw Object.assign(new Error(`${field.toUpperCase()} must be a single line of email addresses.`), { status: 400 });
    }
    if (draft) { result[field] = value.trim(); continue; }
    const addresses = value.trim() ? value.split(/[,;]/).map(address => address.trim()) : [];
    if (addresses.some(address => address.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(address) || address.startsWith('.') || address.includes('..') || address.includes('.@'))) {
      throw Object.assign(new Error(`Enter valid ${field.toUpperCase()} email addresses, separated by commas or semicolons.`), { status: 400 });
    }
    count += addresses.length;
    result[field] = addresses.filter(address => {
      const key = address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).join(', ');
  }
  if (!draft && (!seen.size || count > 100)) throw Object.assign(new Error('Use between 1 and 100 recipients across To, Cc, and Bcc.'), { status: 400 });
  return result;
}
