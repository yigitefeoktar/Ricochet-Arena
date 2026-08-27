import React, { useEffect, useId, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  type GateDefinition,
  type GatePhase,
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
const PREVIEW_GATE_DELAY_SCALE = 0.18;
const PREVIEW_GATE_TIMINGS_MS: Record<GatePhase, number> = {
  closed: 420,
  warning_open: 220,
  opening: 260,
  open: 650,
  warning_close: 220,
  closing: 260,
};
const PREVIEW_GATE_PHASES: readonly GatePhase[] = [
  'closed',
  'warning_open',
  'opening',
  'open',
  'warning_close',
  'closing',
];
const PREVIEW_GATE_CYCLE_DURATION_MS = Object.values(PREVIEW_GATE_TIMINGS_MS).reduce(
  (total, duration) => total + duration,
  0,
);

type PreviewGateState = {
  phase: GatePhase;
  openProgress: number;
};

function getPreviewGateState(gate: GateDefinition, elapsedMs: number): PreviewGateState {
  const delayMs = Math.max(0, gate.initialDelayMs ?? 0) * PREVIEW_GATE_DELAY_SCALE;
  if (elapsedMs < delayMs) return { phase: 'closed', openProgress: 0 };

  let cycleTimeMs = (elapsedMs - delayMs) % PREVIEW_GATE_CYCLE_DURATION_MS;
  for (const phase of PREVIEW_GATE_PHASES) {
    const durationMs = PREVIEW_GATE_TIMINGS_MS[phase];
    if (cycleTimeMs < durationMs) {
      if (phase === 'opening') {
        return { phase, openProgress: cycleTimeMs / durationMs };
      }
      if (phase === 'closing') {
        return { phase, openProgress: 1 - cycleTimeMs / durationMs };
      }
      return {
        phase,
        openProgress: phase === 'open' || phase === 'warning_close' ? 1 : 0,
      };
    }
    cycleTimeMs -= durationMs;
  }

  return { phase: 'closed', openProgress: 0 };
}

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
  const previewId = useId().replace(/:/g, '');
  const patternId = `map-preview-grid-${previewId}`;
  const hasAnimatedFeatures = Boolean(map.gates?.length) || map.spawners.some(spawner =>
    isTitanRelicType(spawner.specialType),
  );
  const previewTimeMs = usePreviewClock(hasAnimatedFeatures);

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
        const state = getPreviewGateState(gate, previewTimeMs);
        const openProgress = state.openProgress;
        const isHorizontal = gate.orientation === 'horizontal';
        const panelExtent = (isHorizontal ? gate.w : gate.h) * 0.5 * (1 - openProgress);
        const isWarning = state.phase === 'warning_open' || state.phase === 'warning_close';
        const warningPulse = isWarning ? 0.55 + 0.45 * Math.sin(previewTimeMs * 0.018) : 1;
        const panelStroke = isWarning ? '#ff5a1f' : '#ffcc00';
        const statusColor = isWarning ? '#ff5a1f' : (openProgress > 0.98 ? '#00ffaa' : '#ffcc00');
        const panelRects = panelExtent > 0.5
          ? isHorizontal
            ? [
                { x: gate.x, y: gate.y, w: panelExtent, h: gate.h },
                { x: gate.x + gate.w - panelExtent, y: gate.y, w: panelExtent, h: gate.h },
              ]
            : [
                { x: gate.x, y: gate.y, w: gate.w, h: panelExtent },
                { x: gate.x, y: gate.y + gate.h - panelExtent, w: gate.w, h: panelExtent },
              ]
          : [];

        return (
          <g
            key={`gate-${gate.id || index}`}
            data-map-preview-feature="gate"
            data-gate-id={gate.id}
            data-gate-phase={state.phase}
            data-gate-open-progress={openProgress.toFixed(3)}
          >
            <rect
              x={gate.x}
              y={gate.y}
              width={gate.w}
              height={gate.h}
              fill="none"
              stroke={`rgba(255, 204, 0, ${0.28 + warningPulse * 0.32})`}
              strokeWidth="14"
              strokeDasharray="38 26"
            />
            {panelRects.map((panel, panelIndex) => (
              <rect
                key={`panel-${panelIndex}`}
                x={panel.x}
                y={panel.y}
                width={panel.w}
                height={panel.h}
                fill="#17130a"
                stroke={panelStroke}
                strokeWidth="18"
                style={{ filter: `drop-shadow(0 0 ${isWarning ? 12 * warningPulse : 6}px ${panelStroke})` }}
              />
            ))}
            {isHorizontal ? (
              <>
                <rect x={gate.x - 28} y={gate.y + gate.h * 0.25} width={18} height={gate.h * 0.5} fill={statusColor} />
                <rect x={gate.x + gate.w + 10} y={gate.y + gate.h * 0.25} width={18} height={gate.h * 0.5} fill={statusColor} />
              </>
            ) : (
              <>
                <rect x={gate.x + gate.w * 0.25} y={gate.y - 28} width={gate.w * 0.5} height={18} fill={statusColor} />
                <rect x={gate.x + gate.w * 0.25} y={gate.y + gate.h + 10} width={gate.w * 0.5} height={18} fill={statusColor} />
              </>
            )}
          </g>
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
