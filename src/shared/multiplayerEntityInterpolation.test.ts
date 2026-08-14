import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendEntityMotionSample,
  sampleEntityMotion,
} from './multiplayerEntityInterpolation';

test('entity motion samples interpolate smoothly between host snapshots', () => {
  const samples = [
    { time: 100, x: 10, y: 20 },
    { time: 150, x: 20, y: 40 },
  ];
  assert.deepEqual(sampleEntityMotion(samples, 125), {
    x: 15,
    y: 30,
    mode: 'interpolated',
  });
});

test('entity extrapolation is bounded and then freezes instead of running away', () => {
  const samples = [
    { time: 100, x: 0, y: 0 },
    { time: 150, x: 10, y: 5 },
  ];
  assert.deepEqual(sampleEntityMotion(samples, 1_000, 50), {
    x: 20,
    y: 10,
    mode: 'extrapolated',
  });
});

test('out-of-order and duplicate samples produce one ordered bounded history', () => {
  let samples = appendEntityMotionSample([], { time: 150, x: 15, y: 15 });
  samples = appendEntityMotionSample(samples, { time: 100, x: 10, y: 10 });
  samples = appendEntityMotionSample(samples, { time: 150, x: 16, y: 16 });
  assert.deepEqual(samples, [
    { time: 100, x: 10, y: 10 },
    { time: 150, x: 16, y: 16 },
  ]);
});

test('malformed samples are ignored', () => {
  const original = [{ time: 100, x: 10, y: 10 }];
  assert.deepEqual(
    appendEntityMotionSample(original, { time: Number.NaN, x: 20, y: 20 }),
    original,
  );
});

test('20 Hz authoritative motion stays smooth when packet receipt times jitter', () => {
  let samples: Array<{ time: number; x: number; y: number }> = [];
  const receiptJitter = [0, 18, -9, 27, -14, 8, 3];
  const rendered: number[] = [];

  for (let hostTime = 0; hostTime <= 500; hostTime += 50) {
    samples = appendEntityMotionSample(samples, {
      time: hostTime,
      x: hostTime * 0.2,
      y: 0,
    });
    const receiptTime = hostTime + 30 + receiptJitter[(hostTime / 50) % receiptJitter.length];
    const sampled = sampleEntityMotion(samples, receiptTime - 75);
    if (sampled) rendered.push(sampled.x);
  }

  for (let index = 1; index < rendered.length; index += 1) {
    assert.ok(rendered[index] >= rendered[index - 1]);
    assert.ok(rendered[index] - rendered[index - 1] <= 20);
  }
});
