/* Offline coverage and scope gates; no network, credentials or database writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });
for (const file of ['public-copy.js', 'public-device-copy.js', 'public-ui-copy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const copy = context.window.CryoPublicCopy;
const source = execFileSync('python3', [path.join(__dirname, 'public-i18n-strings.py')], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
const missing = source.filter(text => !copy[text]);
assert.deepEqual(missing, [], 'Missing English translations:\n' + missing.join('\n'));
for (const [mn, en] of Object.entries(copy)) {
  assert.ok(en && typeof en === 'string', 'Empty translation: ' + mn);
  assert.ok(!/[А-Яа-яӨөҮүЁё]/.test(en), 'Untranslated Cyrillic: ' + mn);
  assert.ok(!/[<>]/.test(en), 'Translations must be plain text: ' + mn);
}
const pages = ['index', 'hub', 'cabin', 'xcryo', 'oxypro', 'ledpro', 'privacy', 'data-deletion'];
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page + '.html'), 'utf8');
  for (const asset of ['public-copy.js', 'public-device-copy.js', 'public-ui-copy.js', 'public-i18n.js', 'public-i18n.css']) {
    assert.ok(html.includes(asset), page + ' missing ' + asset);
    assert.ok(fs.readFileSync(path.join(__dirname, 'build-public.mjs'), 'utf8').includes('"' + asset + '"'), 'Missing build asset ' + asset);
  }
}
assert.ok(!fs.readFileSync(path.join(root, 'admin.html'), 'utf8').includes('public-i18n'), 'ERP must not load public i18n');
const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(changed.filter(file => /^(admin|erp|package-|sports-|excel-|supabase|data\.js|booking-time|name-search|shared\.css)/.test(file)), [], 'Protected ERP/backend files changed');
console.log(`PASS: ${source.length} unique public strings translated; ${Object.keys(copy).length} total copy entries; all 8 pages and build assets covered; ERP/backend files untouched.`);
