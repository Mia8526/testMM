import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmbeddedTaiwanCode,
  hasCjk,
  pickTaiwanNameMatch,
  rankTaiwanNameMatches,
} from './taiwanQuery.ts';

const listed = {
  '2330': '台積電',
  '2454': '聯發科',
  '2002': '中鋼',
  '2013': '中鋼構',
  '2412': '中華電',
  '2059': '川湖',
};

const otc = {
  '8299': '群聯',
  '3081': '聯亞',
  '6488': '環球晶',
};

test('exact Chinese short name resolves listed ticker', () => {
  const hit = pickTaiwanNameMatch('台積電', listed, otc);
  assert.equal(hit?.code, '2330');
  assert.equal(hit?.market, 'TW');
});

test('prefix Chinese query still prefers the short listed name', () => {
  const hit = pickTaiwanNameMatch('台積', listed, otc);
  assert.equal(hit?.code, '2330');
});

test('OTC Chinese short name resolves TWO', () => {
  const hit = pickTaiwanNameMatch('群聯', listed, otc);
  assert.equal(hit?.code, '8299');
  assert.equal(hit?.market, 'TWO');
});

test('exact 中鋼 beats 中鋼構', () => {
  const hit = pickTaiwanNameMatch('中鋼', listed, otc);
  assert.equal(hit?.code, '2002');
});

test('single CJK character does not fuzzy-match every name', () => {
  const hits = rankTaiwanNameMatches('台', listed, otc);
  assert.equal(hits.every((h) => h.name === '台' || h.name.startsWith('台')), true);
  assert.equal(hits.some((h) => h.name.includes('台') && !h.name.startsWith('台')), false);
});

test('ticker or English query is not treated as a Chinese name', () => {
  assert.equal(hasCjk('2330'), false);
  assert.equal(pickTaiwanNameMatch('2330', listed, otc), null);
  assert.equal(pickTaiwanNameMatch('NVDA', listed, otc), null);
});

test('embedded code wins over the Chinese text around it', () => {
  assert.equal(extractEmbeddedTaiwanCode('台積電 2330'), '2330');
  assert.equal(extractEmbeddedTaiwanCode('群聯8299.TWO'), '8299.TWO');
});
