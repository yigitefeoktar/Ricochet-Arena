import React, { useEffect, useId, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  advanceGateStateWithTransitions,
  createInitialGateStates,
  GATE_TIMINGS_MS,
  getGateOpenProgress,
  type GateDefinition,
} from '../shared/gateMechanics';
import {
  getTitanRelicPalette,
  getTitanRelicPrimitives,
  isTitanRelicType,
} from '../shared/relicGeometry';

type PreviewWall = { x: number; y: number; w: number; h: number };
type PreviewSpawner = {
  x: number;
  y: number;
  radius: number;
  specialType?: string;
};

export type MapPreviewDefinition = {
  walls: readonly PreviewWall[];
  spawners: readonly PreviewSpawner[];
  spawnPoint?: { x: number; y: number };
  gates?: readonly GateDefinition[];
};

type MapPreviewSvgProps = {
  map: MapPreviewDefinition;
  className: string;
  theme?: 'cyan' | 'gold';
  wallTheme?: 'cyan' | 'gold';
  gridSize?: 150 | 300;
  detailedSpawnPoint?: boolean;
};

const PREVIEW_FRAME_INTERVAL_MS = 1000 / 60;
const GATE_CYCLE_DURATION_MS = Object.values(GATE_TIMINGS_MS).reduce(
  (total, duration) => total + duration,
  0,
);

function usePreviewClock(shouldAnimate: boolean): number {
  const prefersReducedMotion = useReducedMotion();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!shouldAnimate || prefersReducedMotion) {
      setElapsedMs(0);
      return;
    }

    const startedAt = performance.now();
    let previousFrameAt = startedAt;
    let frameId = 0;

    const update = (now: number) => {
      if (now - previousFrameAt >= PREVIEW_FRAME_INTERVAL_MS) {
        setElapsedMs(now - startedAt);
        previousFrameAt = now;
      }
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [prefersReducedMotion, shouldAnimate]);

  return elapsedMs;
}

/**
 * Render-only map miniature shared by every selector and lobby surface.
 * It reads the real gate timings and titan-relic geometry, but it never reads
 * or mutates a live game world.
 */
export function MapPreviewSvg({
  map,
  className,
  theme = 'cyan',
  wallTheme = theme,
  gridSize = 150,
  detailedSpawnPoint = false,
}: MapPreviewSvgProps) {
  const patternId = `map-preview-grid-${useId().replace(/:/g, '')}`;
  const hasAnimatedFeatures = Boolean(map.gates?.length) || map.spawners.some(spawner =>
    isTitanRelicType(spawner.specialType),
  );
  const previewTimeMs = usePreviewClock(hasAnimatedFeatures);
  const gateInitialStates = map.gates ? createInitialGateStates(map.gates, 0) : [];

  const frameColor = theme === 'gold' ? '#ffcc00' : '#00f0ff';
  const wallColor = wallTheme === 'gold' ? '#ffcc00' : '#00f0ff';
  const frameFill = wallTheme === 'gold' ? 'rgba(255, 204, 0, 0.25)' : 'rgba(0, 240, 255, 0.25)';
  const gridColor = theme === 'gold' ? 'rgba(255, 204, 0, 0.08)' : 'rgba(0, 240, 255, 0.05)';

  return (
    <svg
      viewBox="0 0 3000 3000"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      data-map-preview-animated={hasAnimatedFeatures ? 'true' : 'false'}
    >
      <rect width="3000" height="3000" fill="#050508" stroke={frameColor} strokeOpacity={0.4} strokeWidth="15" />
      <defs>
        <pattern id={patternId} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
          <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke={gridColor} strokeWidth={gridSize === 300 ? 8 : 4} />
        </pattern>
      </defs>
      <rect width="3000" height="3000" fill={`url(#${patternId})`} />

      {map.walls.map((wall, index) => (
        <rect
          key={`wall-${index}`}
          x={wall.x}
          y={wall.y}
          width={wall.w}
          height={wall.h}
          fill={frameFill}
          stroke={wallColor}
          strokeWidth="15"
        />
      ))}

      {map.gates?.map((gate, index) => {
        const initialState = gateInitialStates[index];
        const initialDelayMs = Math.max(0, gate.initialDelayMs ?? 0);
        const boundedGateTimeMs = previewTimeMs < initialDelayMs
          ? previewTimeMs
          : initialDelayMs + (previewTimeMs - initialDelayMs) % GATE_CYCLE_DURATION_MS;
        const state = initialState
          ? advanceGateStateWithTransitions(initialState, boundedGateTimeMs).state
          : null;
        const openProgress = state ? getGateOpenProgress(state, boundedGateTimeMs) : 0;
        const isHorizontal = gate.orientation === 'horizontal';
        const width = isHorizontal ? gate.w * (1 - openProgress) : gate.w;
        const height = isHorizontal ? gate.h : gate.h * (1 - openProgress);
        const x = gate.x + (gate.w - width) / 2;
        const y = gate.y + (gate.h - height) / 2;
        const isWarning = state?.phase === 'warning_open' || state?.phase === 'warning_close';

        return (
          <rect
            key={`gate-${gate.id || index}`}
            data-map-preview-feature="gate"
            data-gate-phase={state?.phase ?? 'closed'}
            x={x}
            y={y}
            width={Math.max(0, width)}
            height={Math.max(0, height)}
            fill={isWarning ? 'rgba(255, 92, 0, 0.58)' : 'rgba(255, 204, 0, 0.42)'}
            stroke={isWarning ? '#ff5c00' : '#ffcc00'}
            strokeWidth="20"
          />
        );
      })}

      {map.spawners.map((spawner, spawnerIndex) => {
        const palette = getTitanRelicPalette(spawner.specialType);
        return (
          <g key={`spawner-${spawnerIndex}`}>
            {isTitanRelicType(spawner.specialType) && getTitanRelicPrimitives(spawner, previewTimeMs).map(primitive =>
              primitive.kind === 'circle' ? (
                <circle
                  key={`titan-${primitive.id}`}
                  data-map-preview-feature="titan-relic"
                  cx={primitive.cx}
                  cy={primitive.cy}
                  r={primitive.radius}
                  fill={palette.fill}
                  stroke={palette.accent}
                  strokeWidth={12}
                />
              ) : (
                <line
                  key={`titan-${primitive.id}`}
                  data-map-preview-feature="titan-relic"
                  x1={primitive.ax}
                  y1={primitive.ay}
                  x2={primitive.bx}
                  y2={primitive.by}
                  stroke={palette.fill}
                  strokeWidth={primitive.radius * 2}
                  strokeLinecap="round"
                />
              ),
            )}
            <circle
              cx={spawner.x}
              cy={spawner.y}
              r={spawner.radius}
              fill="#ff00ff"
              stroke="rgba(255, 255, 255, 0.5)"
              strokeWidth="8"
            />
          </g>
        );
      })}

      {map.spawnPoint && (
        <g transform={`translate(${map.spawnPoint.x}, ${map.spawnPoint.y})`} pointerEvents="none" aria-hidden="true">
          <circle r={70} fill={detailedSpawnPoint ? 'rgba(255, 204, 0, 0.10)' : 'rgba(255, 204, 0, 0.15)'} stroke="#FFCC00" strokeWidth={18} />
          <circle r={18} fill="#FFCC00" />
          {detailedSpawnPoint && (
            <>
              <line x1={0} y1={-110} x2={0} y2={-80} stroke="#FFCC00" strokeWidth={18} />
              <line x1={0} y1={80} x2={0} y2={110} stroke="#FFCC00" strokeWidth={18} />
              <line x1={-110} y1={0} x2={-80} y2={0} stroke="#FFCC00" strokeWidth={18} />
              <line x1={80} y1={0} x2={110} y2={0} stroke="#FFCC00" strokeWidth={18} />
              <text
                x={100}
                y={-80}
                fill="#FFCC00"
                fontSize={120}
                fontFamily="monospace"
                fontWeight="bold"
                stroke="#080A12"
                strokeWidth={30}
                paintOrder="stroke"
                strokeLinejoin="round"
                style={{ letterSpacing: '0.1em', filter: 'drop-shadow(0px 2px 2px rgba(255, 204, 0, 0.35))' }}
              >
                START
              </text>
            </>
          )}
        </g>
      )}
    </svg>
  );
}
