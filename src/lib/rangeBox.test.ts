import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRangeBox, type OhlcBar } from './rangeBox.ts';

const bars = (base: number, upper: number, lower: number, breakdown: number): OhlcBar[] => {
  const out: OhlcBar[] = [];
  for (let i = 0; i < 32; i++) {
    const close = base + (i % 6 - 2.5) * (upper - lower) / 12;
    out.push({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, high: i % 5 === 0 ? upper : close + 2, low: i % 5 === 2 ? lower : close - 2, close, volume: 1000 });
  }
  out.splice(20, 0, { date: '2026-05-00', high: upper * 2, low: lower / 2, close: lower / 2, volume: 0 });
  for (let i = 0; i < 3; i++) out.push({ date: `2026-06-0${i + 1}`, high: lower - 1, low: breakdown - 2, close: breakdown, volume: 2000 });
  return out;
};

test('8042 preserves recent structural box after confirmed breakdown and ignores zero-volume 99', () => {
  const result = detectRangeBox(bars(188, 200, 178, 165), 165);
  assert.equal(result.breakdown, true);
  assert.ok(result.lower! >= 176 && result.lower! <= 180, `lower=${result.lower}`);
  assert.notEqual(result.lower, 99);
});

test('2454 preserves prior lower near 4100', () => {
  const result = detectRangeBox(bars(4300, 4500, 4100, 3950), 3950);
  assert.equal(result.breakdown, true);
  assert.ok(result.lower! >= 4050 && result.lower! <= 4150, `lower=${result.lower}`);
});

test('zero-volume bars are excluded from lookback count', () => {
  const result = detectRangeBox(bars(188, 200, 178, 165), 165);
  assert.equal(result.lookbackDays, 35);
});
