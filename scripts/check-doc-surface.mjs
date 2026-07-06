import { readFileSync } from 'node:fs';

const required = [
  'inAppUsers',
  'asLeaderboard',
  'traderScore',
  'mbd.ingest',
  'user_id_from',
  'user_id_to',
];

const files = ['index.d.ts', 'llms.txt', 'release_notes.md'];
const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');
const missing = required.filter((term) => !combined.includes(term));

if (missing.length) {
  console.error(`Missing documented DSL surface: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`DSL docs surface OK (${required.length} terms).`);
