'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
  const input = fs.readFileSync(0, 'utf8');
  const items = JSON.parse(input);

  const helperPath = path.resolve(__dirname, '../../../frontend/src/utils/dateUtils.js');
  const mod = await import('file:///' + helperPath.replace(/\\/g, '/'));

  const results = items.map((x) => {
    const res = mod.getDiaCalendarioConTrasnoche(x.iso, x.horariosClub);
    return res?.key || null;
  });

  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => {
  console.error('[frontend-date-worker ERROR]:', err);
  process.exit(1);
});
