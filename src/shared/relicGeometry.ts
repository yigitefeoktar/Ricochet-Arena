export type ColossusBladeSegment = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  thickness: number;
};

export function getColossusBladeSegments(
  spawner: { x: number; y: number },
  currentTime: number
): ColossusBladeSegment[] {
  const seed = Math.round(spawner.x / 10) * 17 + Math.round(spawner.y / 10) * 31;
  const direction = seed % 2 === 0 ? 1 : -1;
  const phaseOffset = (seed % 360) * Math.PI / 180;
  const angleOffset = phaseOffset + direction * currentTime * 0.00032;
  const orbitRadius = 190;
  const halfLength = 92;
  const thickness = 16;

  return Array.from({ length: 3 }, (_, index) => {
    const angle = angleOffset + index * Math.PI * 2 / 3;
    const centerX = spawner.x + Math.cos(angle) * orbitRadius;
    const centerY = spawner.y + Math.sin(angle) * orbitRadius;
    const tangentX = -Math.sin(angle);
    const tangentY = Math.cos(angle);
    return {
      ax: centerX - tangentX * halfLength,
      ay: centerY - tangentY * halfLength,
      bx: centerX + tangentX * halfLength,
      by: centerY + tangentY * halfLength,
      thickness,
    };
  });
}
