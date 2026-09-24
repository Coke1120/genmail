// Keep the Rust executable's static data identical to the existing shared client contracts.
import { AI_BEHAVIORS, DEFAULT_POLICY, DEFAULT_PREFERENCES, DEFAULT_SKILLS } from '../shared/features.js';
import { createDemoMessages } from '../server/demo.js';
import { configs } from 'opencc-js/preset/t2cn';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const group = dictionaries => {
  const entries = new Map();
  for (const dictionary of [...dictionaries].reverse()) for (const [key, value] of typeof dictionary === 'string' ? dictionary.split('|').map(line => line.split(' ').slice(0, 2)) : dictionary) entries.set(key, value);
  return [...entries];
};
const config = configs.hk2s;
const files = {
  'catalog.json': { features: AI_BEHAVIORS, policy: { ...DEFAULT_POLICY, summarySchedule: { ...DEFAULT_POLICY.summarySchedule, timeZone: 'UTC' } }, preferences: DEFAULT_PREFERENCES, skills: DEFAULT_SKILLS, demo: createDemoMessages(0) },
  'opencc.json': { normalization: config.normalizationChain.map(group), segmentation: group(config.segmentation), conversion: config.conversionChain.map(group) },
};
mkdirSync(new URL('../rust/resources/', import.meta.url), { recursive: true });
for (const [name, value] of Object.entries(files)) {
  const path = new URL('../rust/resources/' + name, import.meta.url), content = JSON.stringify(value) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== content) throw Error(`Rust resource ${name} is stale. Run node scripts/rust-resources.js.`);
  } else writeFileSync(path, content);
}
