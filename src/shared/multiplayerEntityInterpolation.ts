export interface EntityMotionSample {
  time: number;
  x: number;
  y: number;
}

export interface SampledEntityMotion {
  x: number;
  y: number;
  mode: 'held' | 'interpolated' | 'extrapolated';
}

export const MULTIPLAYER_ENTITY_INTERPOLATION_DELAY_MS = 75;
export const MULTIPLAYER_ENTITY_MAX_EXTRAPOLATION_MS = 50;

export function appendEntityMotionSample(
  samples: readonly EntityMotionSample[],
  sample: EntityMotionSample,
  maximumSamples: number = 6,
): EntityMotionSample[] {
  if (
    !Number.isFinite(sample.time) ||
    !Number.isFinite(sample.x) ||
    !Number.isFinite(sample.y)
  ) {
    return [...samples];
  }

  const next = samples.filter(existing => existing.time !== sample.time);
  next.push(sample);
  next.sort((a, b) => a.time - b.time);
  return next.slice(-Math.max(2, maximumSamples));
}

export function sampleEntityMotion(
  samples: readonly EntityMotionSample[],
  renderTime: number,
  maximumExtrapolationMs: number = MULTIPLAYER_ENTITY_MAX_EXTRAPOLATION_MS,
): SampledEntityMotion | null {
  if (samples.length === 0 || !Number.isFinite(renderTime)) return null;

  const first = samples[0];
  if (renderTime <= first.time || samples.length === 1) {
    return { x: first.x, y: first.y, mode: 'held' };
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const next = samples[index];
    if (renderTime > next.time) continue;
    const duration = next.time - previous.time;
    if (duration <= 0) return { x: next.x, y: next.y, mode: 'held' };
    const t = Math.max(0, Math.min(1, (renderTime - previous.time) / duration));
    return {
      x: previous.x + (next.x - previous.x) * t,
      y: previous.y + (next.y - previous.y) * t,
      mode: 'interpolated',
    };
  }

  const latest = samples[samples.length - 1];
  const previous = samples[samples.length - 2];
  const sampleDuration = latest.time - previous.time;
  if (sampleDuration <= 0) return { x: latest.x, y: latest.y, mode: 'held' };

  const extrapolationMs = Math.max(
    0,
    Math.min(maximumExtrapolationMs, renderTime - latest.time),
  );
  if (extrapolationMs === 0) return { x: latest.x, y: latest.y, mode: 'held' };

  return {
    x: latest.x + (latest.x - previous.x) * (extrapolationMs / sampleDuration),
    y: latest.y + (latest.y - previous.y) * (extrapolationMs / sampleDuration),
    mode: 'extrapolated',
  };
}
