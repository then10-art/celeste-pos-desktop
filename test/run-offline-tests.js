const { spawnSync } = require('node:child_process');
const path = require('node:path');

const electronPath = require('electron');
const testFile = path.join(__dirname, 'offline-core.test.js');
const result = spawnSync(electronPath, ['--test', testFile], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
