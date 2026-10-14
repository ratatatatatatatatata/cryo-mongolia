import assert from 'node:assert/strict';
import { matchesName } from '../name-search.js';
for (const [name, query] of [
  ['Бат-Эрдэнэ', 'bat erdene'], ['Бат-Эрдэнэ', 'bat'],
  ['Энхжин', 'enkhjin'], ['Энхжин', 'enhjin'],
  ['Түмэн', 'tumen'], ['Өлзий', 'olzii'],
  ['Bat-Erdene', 'Батэрдэнэ'], ['Enkhjin', 'Энхжин'],
  ['Сүхбаатар', 'sukhbaatar'], ['Бат', ''],
]) assert.ok(matchesName(name, query), `${name} should match ${query}`);
assert.equal(matchesName('Бат', 'Сараа'), false);
assert.equal(matchesName('Сараа', '123'), false);
console.log('12 name search checks passed');
