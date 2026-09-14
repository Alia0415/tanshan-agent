"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./resonance-globe-canvas.module.css";
import { EARTH_LAND_POLYGONS } from "./resonance-globe-land";

export type ResonanceGlobeCanvasProps = {
  className?: string;
  connectionCount?: number | null;
  active?: boolean;
};

type GeoPoint = readonly [longitude: number, latitude: number];
type Vector3 = readonly [x: number, y: number, z: number];
type SurfacePoint = {
  vector: Vector3;
  sparkle: number;
};
type FloatingParticle = {
  angle: number;
  distance: number;
  yScale: number;
  size: number;
  phase: number;
  speed: number;
  opacity: number;
  sparkle: number;
};
type RouteSample = {
  vector: Vector3;
  lift: number;
};
type Route = {
  samples: readonly RouteSample[];
  from: Vector3;
  to: Vector3;
  phase: number;
};
type ProjectedPoint = {
  x: number;
  y: number;
  depth: number;
};
type HoverPoint = {
  x: number;
  y: number;
  active: boolean;
};

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const INITIAL_ROTATION = -104 * DEG;
const AXIS_TILT = -8.5 * DEG;

// The map is kept in its own model file so this renderer can stay focused on animation.
const LAND_POLYGONS = EARTH_LAND_POLYGONS;

const ROUTE_ENDPOINTS: readonly (readonly [GeoPoint, GeoPoint])[] = [
  [[120.2, 30.3], [139.7, 35.7]],
  [[120.2, 30.3], [127, 37.5]],
  [[120.2, 30.3], [103.8, 1.3]],
  [[120.2, 30.3], [77.2, 28.6]],
  [[120.2, 30.3], [55.3, 25.2]],
  [[120.2, 30.3], [2.35, 48.9]],
  [[120.2, 30.3], [151.2, -33.9]],
];

function smoothClosedPolygon(polygon: readonly GeoPoint[], samplesPerSegment = 5): readonly GeoPoint[] {
  const smoothed: GeoPoint[] = [];
  const count = polygon.length;
  for (let index = 0; index < count; index += 1) {
    const [p0x, p0y] = polygon[(index - 1 + count) % count];
    const [p1x, p1y] = polygon[index];
    const [p2x, p2y] = polygon[(index + 1) % count];
    const [p3x, p3y] = polygon[(index + 2) % count];
    for (let sample = 0; sample < samplesPerSegment; sample += 1) {
      const t = sample / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const longitude = 0.5 * (
        2 * p1x
        + (-p0x + p2x) * t
        + (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2
        + (-p0x + 3 * p1x - 3 * p2x + p3x) * t3
      );
      const latitude = 0.5 * (
        2 * p1y
        + (-p0y + p2y) * t
        + (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2
        + (-p0y + 3 * p1y - 3 * p2y + p3y) * t3
      );
      smoothed.push([longitude, clamp(latitude, -84, 84)]);
    }
  }
  return smoothed;
}

const SMOOTHED_LAND_POLYGONS = LAND_POLYGONS.map((polygon) => smoothClosedPolygon(polygon, 4));

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function hash(value: number) {
  return Math.abs(Math.sin(value * 12.9898 + 78.233) * 43758.5453) % 1;
}

function geoVector([longitude, latitude]: GeoPoint): Vector3 {
  const lon = longitude * DEG;
  const lat = latitude * DEG;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.sin(lon), Math.sin(lat), cosLat * Math.cos(lon)];
}

function pointInPolygon(longitude: number, latitude: number, polygon: readonly GeoPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[previous];
    const crosses = (y1 > latitude) !== (y2 > latitude);
    if (crosses && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function buildLandPoints(): readonly SurfacePoint[] {
  const points: SurfacePoint[] = [];
  const step = 1.4;
  let index = 0;

  for (let latitude = -56; latitude <= 81; latitude += step) {
    for (let longitude = -179; longitude <= 179; longitude += step) {
      const jitteredLon = longitude + (hash(index + 0.17) - 0.5) * step * 0.72;
      const jitteredLat = latitude + (hash(index + 0.83) - 0.5) * step * 0.64;
      index += 1;
      if (!LAND_POLYGONS.some((polygon) => pointInPolygon(jitteredLon, jitteredLat, polygon))) {
        continue;
      }
      points.push({
        vector: geoVector([jitteredLon, jitteredLat]),
        sparkle: hash(index * 1.719),
      });
    }
  }

  return points;
}

function buildOceanPoints(): readonly SurfacePoint[] {
  const points: SurfacePoint[] = [];
  const step = 2.35;
  let index = 0;

  // A second, wider grid fills the water softly without competing with the denser land cloud.
  for (let latitude = -84; latitude <= 84; latitude += step) {
    for (let longitude = -179; longitude < 180; longitude += step) {
      const jitteredLon = longitude + (hash(index + 101.17) - 0.5) * step * 0.54;
      const jitteredLat = latitude + (hash(index + 101.83) - 0.5) * step * 0.48;
      index += 1;
      if (LAND_POLYGONS.some((polygon) => pointInPolygon(jitteredLon, jitteredLat, polygon))) {
        continue;
      }
      points.push({
        vector: geoVector([jitteredLon, jitteredLat]),
        sparkle: hash(index * 2.913),
      });
    }
  }

  return points;
}

function buildFloatingParticles(): readonly FloatingParticle[] {
  return Array.from({ length: 1280 }, (_, index) => ({
    angle: hash(index * 1.83 + 0.7) * TAU,
    distance: 1.03 + hash(index * 2.17 + 1.1) * 0.5,
    yScale: 0.62 + hash(index * 3.07 + 2.3) * 0.46,
    size: 0.00065 + hash(index * 4.11 + 3.9) * 0.0032,
    phase: hash(index * 5.37 + 4.8) * TAU,
    speed: (hash(index * 6.19 + 5.4) - 0.5) * 0.000055,
    opacity: 0.1 + hash(index * 7.13 + 6.2) * 0.3,
    sparkle: hash(index * 8.31 + 7.6),
  }));
}

function buildCoastPaths(): readonly (readonly Vector3[])[] {
  return SMOOTHED_LAND_POLYGONS.map((polygon) => {
    const path: Vector3[] = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const [startLon, startLat] = polygon[index];
      const [endLon, endLat] = polygon[(index + 1) % polygon.length];
      const distance = Math.hypot(endLon - startLon, endLat - startLat);
      const samples = Math.max(3, Math.ceil(distance / 1.35));
      for (let step = 0; step < samples; step += 1) {
        const progress = step / samples;
        path.push(
          geoVector([
            startLon + (endLon - startLon) * progress,
            startLat + (endLat - startLat) * progress,
          ]),
        );
      }
    }
    path.push(geoVector(polygon[0]));
    return path;
  });
}

function slerp(start: Vector3, end: Vector3, progress: number): Vector3 {
  const dot = clamp(start[0] * end[0] + start[1] * end[1] + start[2] * end[2], -1, 1);
  const angle = Math.acos(dot);
  if (angle < 0.0001) return start;
  const denominator = Math.sin(angle);
  const startWeight = Math.sin((1 - progress) * angle) / denominator;
  const endWeight = Math.sin(progress * angle) / denominator;
  return [
    start[0] * startWeight + end[0] * endWeight,
    start[1] * startWeight + end[1] * endWeight,
    start[2] * startWeight + end[2] * endWeight,
  ];
}

function buildRoutes(): readonly Route[] {
  return ROUTE_ENDPOINTS.map(([fromGeo, toGeo], routeIndex) => {
    const from = geoVector(fromGeo);
    const to = geoVector(toGeo);
    const angularDistance = Math.acos(clamp(
      from[0] * to[0] + from[1] * to[1] + from[2] * to[2],
      -1,
      1,
    ));
    const height = Math.min(0.24, 0.085 + angularDistance * 0.075);
    const samples: RouteSample[] = [];
    for (let index = 0; index <= 72; index += 1) {
      const progress = index / 72;
      samples.push({
        vector: slerp(from, to, progress),
        lift: 1 + Math.sin(Math.PI * progress) * height,
      });
    }
    return { samples, from, to, phase: hash(routeIndex + 4.2) };
  });
}

const LAND_POINTS = buildLandPoints();
const OCEAN_POINTS = buildOceanPoints();
const FLOATING_PARTICLES = buildFloatingParticles();
const COAST_PATHS = buildCoastPaths();
const ROUTES = buildRoutes();

function project(
  vector: Vector3,
  rotation: number,
  centerX: number,
  centerY: number,
  radius: number,
  lift = 1,
): ProjectedPoint {
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const rotatedX = vector[0] * cosRotation + vector[2] * sinRotation;
  const depth = vector[2] * cosRotation - vector[0] * sinRotation;
  const cosTilt = Math.cos(AXIS_TILT);
  const sinTilt = Math.sin(AXIS_TILT);
  const screenX = rotatedX * cosTilt - vector[1] * sinTilt;
  const screenY = rotatedX * sinTilt + vector[1] * cosTilt;
  return {
    x: centerX + screenX * radius * lift,
    y: centerY - screenY * radius * lift,
    depth,
  };
}

function displaceForHover(
  projected: ProjectedPoint,
  hover: HoverPoint,
  radius: number,
  sparkle: number,
  elapsed: number,
): ProjectedPoint {
  const influence = getHoverInfluence(projected, hover, radius);
  if (influence <= 0) return projected;
  const deltaX = projected.x - hover.x;
  const deltaY = projected.y - hover.y;
  const distance = Math.hypot(deltaX, deltaY);
  const angle = distance > 0.001
    ? Math.atan2(deltaY, deltaX)
    : elapsed * 0.001 + sparkle * TAU;
  const wobble = 0.72 + 0.28 * Math.sin(elapsed * 0.0024 + sparkle * 18);
  const displacement = radius * 0.065 * influence * wobble * (0.78 + sparkle * 0.42);
  return {
    ...projected,
    x: projected.x + Math.cos(angle) * displacement,
    y: projected.y + Math.sin(angle) * displacement,
  };
}

function getHoverInfluence(projected: ProjectedPoint, hover: HoverPoint, radius: number) {
  if (!hover.active) return 0;
  const influenceRadius = radius * 0.32;
  const distance = Math.hypot(projected.x - hover.x, projected.y - hover.y);
  if (distance >= influenceRadius) return 0;
  const normalized = 1 - distance / influenceRadius;
  // Smoothstep keeps the push strongest near the cursor and fades it gently at the edge.
  return normalized * normalized * (3 - 2 * normalized);
}

function isHoverClearZone(projected: ProjectedPoint, hover: HoverPoint, radius: number) {
  if (!hover.active) return false;
  return Math.hypot(projected.x - hover.x, projected.y - hover.y) < radius * 0.028;
}

function strokeProjectedPath(
  context: CanvasRenderingContext2D,
  path: readonly Vector3[],
  rotation: number,
  centerX: number,
  centerY: number,
  radius: number,
  horizon = 0.01,
) {
  context.beginPath();
  let drawing = false;
  for (const vector of path) {
    const point = project(vector, rotation, centerX, centerY, radius);
    if (point.depth <= horizon) {
      drawing = false;
      continue;
    }
    if (drawing) context.lineTo(point.x, point.y);
    else context.moveTo(point.x, point.y);
    drawing = true;
  }
  context.stroke();
}

function drawBackgroundGlow(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
) {
  const glow = context.createRadialGradient(
    centerX,
    centerY,
    radius * 0.58,
    centerX,
    centerY,
    radius * 1.42,
  );
  glow.addColorStop(0, "rgba(121, 196, 255, 0.18)");
  glow.addColorStop(0.48, "rgba(143, 211, 255, 0.09)");
  glow.addColorStop(1, "rgba(143, 211, 255, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.44, 0, TAU);
  context.fill();

  const floorGlow = context.createRadialGradient(
    centerX,
    centerY + radius * 0.94,
    0,
    centerX,
    centerY + radius * 0.94,
    radius * 1.08,
  );
  floorGlow.addColorStop(0, "rgba(64, 151, 230, 0.12)");
  floorGlow.addColorStop(1, "rgba(64, 151, 230, 0)");
  context.save();
  context.scale(1, 0.24);
  context.fillStyle = floorGlow;
  context.beginPath();
  context.arc(centerX, (centerY + radius * 0.94) / 0.24, radius * 1.08, 0, TAU);
  context.fill();
  context.restore();
}

function drawSatelliteOrbits(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  elapsed: number,
  reducedMotion: boolean,
) {
  const orbits = [
    { radius: 1.1, flatten: 0.31, rotate: -0.16, alpha: 0.18, dash: false, speed: 0.000065 },
    { radius: 1.22, flatten: 0.2, rotate: 0.26, alpha: 0.12, dash: true, speed: -0.000045 },
    { radius: 1.34, flatten: 0.54, rotate: -0.47, alpha: 0.1, dash: true, speed: 0.000032 },
  ];

  for (const [index, orbit] of orbits.entries()) {
    const rotation = orbit.rotate;
    const cosRotation = Math.cos(rotation);
    const sinRotation = Math.sin(rotation);
    const ringRadius = radius * orbit.radius;
    const verticalOffset = radius * (index - 1) * 0.035;
    context.save();
    context.translate(centerX, centerY + verticalOffset);
    context.rotate(rotation);
    context.beginPath();
    context.ellipse(0, 0, ringRadius, ringRadius * orbit.flatten, 0, 0, TAU);
    context.strokeStyle = `rgba(8, 113, 232, ${orbit.alpha})`;
    context.lineWidth = Math.max(0.7, radius * (index === 0 ? 0.0024 : 0.0015));
    if (orbit.dash) context.setLineDash([radius * 0.018, radius * 0.035]);
    context.stroke();
    context.restore();

    const progress = reducedMotion
      ? 0.2 + index * 0.26
      : (elapsed * orbit.speed + index * 0.27) % 1;
    const angle = progress * TAU;
    const localX = Math.cos(angle) * ringRadius;
    const localY = Math.sin(angle) * ringRadius * orbit.flatten;
    const x = centerX + localX * cosRotation - localY * sinRotation;
    const y = centerY + verticalOffset + localX * sinRotation + localY * cosRotation;
    context.save();
    context.shadowColor = "rgba(8, 113, 232, 0.75)";
    context.shadowBlur = Math.max(4, radius * 0.022);
    context.fillStyle = "rgba(129, 204, 255, 0.92)";
    context.beginPath();
    context.arc(x, y, Math.max(1.25, radius * (0.0055 - index * 0.0007)), 0, TAU);
    context.fill();
    context.restore();
  }
}

function drawFloatingParticles(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  elapsed: number,
  reducedMotion: boolean,
) {
  context.save();
  context.lineCap = "round";
  for (const particle of FLOATING_PARTICLES) {
    const drift = reducedMotion
      ? 0
      : elapsed * particle.speed + Math.sin(elapsed * 0.00045 + particle.phase) * 0.045;
    const angle = particle.angle + drift;
    const bob = reducedMotion
      ? 0
      : Math.sin(elapsed * 0.0011 + particle.phase * 1.7) * radius * 0.022;
    const distance = radius * particle.distance;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance * particle.yScale + bob;
    const depth = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(angle * 1.7 + particle.phase));
    const twinkle = particle.sparkle > 0.9
      ? 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(elapsed * 0.002 + particle.phase))
      : 0.4;
    const alpha = particle.opacity * (0.36 + depth * 0.64) * twinkle;
    const size = Math.max(0.7, radius * particle.size * (0.68 + depth * 0.78));

    context.globalAlpha = alpha;
    context.fillStyle = particle.sparkle > 0.9
      ? "rgba(244, 252, 255, 0.96)"
      : "rgba(24, 117, 210, 0.82)";
    if (particle.sparkle > 0.94) {
      context.shadowColor = "rgba(64, 160, 248, 0.88)";
      context.shadowBlur = Math.max(3, size * 4.5);
    }
    context.beginPath();
    context.arc(x, y, size, 0, TAU);
    context.fill();
    context.shadowBlur = 0;

    if (particle.sparkle > 0.8) {
      context.strokeStyle = `rgba(73, 165, 244, ${alpha * 0.42})`;
      context.lineWidth = Math.max(0.5, size * 0.32);
      context.beginPath();
      context.arc(x, y, size * 2.2, 0, TAU);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  context.restore();
}

function drawSphere(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  rotation: number,
  elapsed: number,
  hover: HoverPoint,
) {
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, TAU);
  context.clip();

  const dotScale = radius / 310;

  context.save();
  for (const point of OCEAN_POINTS) {
    const shimmer = 0.74 + 0.26 * Math.sin(elapsed * 0.0011 + point.sparkle * 32);
    const lift = 0.997 + Math.sin(elapsed * 0.0008 + point.sparkle * 19) * 0.0025;
    const projected = displaceForHover(
      project(point.vector, rotation, centerX, centerY, radius * lift),
      hover,
      radius,
      point.sparkle,
      elapsed,
    );
    if (projected.depth <= 0.012) continue;
    if (isHoverClearZone(projected, hover, radius)) continue;
    const depth = clamp(projected.depth);
    const hoverStrength = getHoverInfluence(projected, hover, radius);
    context.globalAlpha = (0.48 + depth * 0.32) * shimmer;
    context.fillStyle = point.sparkle > 0.92
      ? "rgba(210, 238, 255, 0.98)"
      : "rgba(93, 170, 235, 0.76)";
    const size = Math.max(
      1.2,
      (1.36 + point.sparkle * 0.78 + depth * 0.38 + hoverStrength * 1.3) * dotScale,
    );
    context.fillRect(projected.x - size / 2, projected.y - size / 2, size, size);
  }
  context.restore();

  for (const point of LAND_POINTS) {
    const projected = displaceForHover(
      project(point.vector, rotation, centerX, centerY, radius),
      hover,
      radius,
      point.sparkle,
      elapsed,
    );
    if (projected.depth <= 0.005) continue;
    if (isHoverClearZone(projected, hover, radius)) continue;
    const depth = clamp(projected.depth);
    const hoverStrength = getHoverInfluence(projected, hover, radius);
    const twinkle = point.sparkle > 0.92
      ? 0.12 * (0.5 + 0.5 * Math.sin(elapsed * 0.0014 + point.sparkle * 18))
      : 0;
    context.globalAlpha = 0.58 + depth * 0.42 + twinkle + hoverStrength * 0.16;
    context.fillStyle = point.sparkle > 0.82
      ? "rgba(255, 255, 255, 0.98)"
      : "rgba(3, 78, 170, 0.7)";
    const size = Math.max(
      0.72,
      (0.7 + point.sparkle * 0.68 + depth * 0.42 + hoverStrength * 1.05) * dotScale,
    );
    context.fillRect(projected.x - size / 2, projected.y - size / 2, size, size);
  }
  context.globalAlpha = 1;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(8, 113, 232, 0.88)";
  context.lineWidth = Math.max(1.05, radius * 0.00365);
  context.shadowColor = "rgba(8, 113, 232, 0.56)";
  context.shadowBlur = radius * 0.014;
  for (const coast of COAST_PATHS) {
    strokeProjectedPath(context, coast, rotation, centerX, centerY, radius, 0.015);
  }
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(113, 190, 255, 0.68)";
  context.lineWidth = Math.max(0.5, radius * 0.00145);
  for (const coast of COAST_PATHS) {
    strokeProjectedPath(context, coast, rotation, centerX, centerY, radius, 0.015);
  }
  context.restore();
  context.restore();
}

function drawGlobeOutline(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
) {
  context.save();
  context.strokeStyle = "rgba(8, 113, 232, 0.24)";
  context.shadowColor = "rgba(8, 113, 232, 0.2)";
  context.shadowBlur = radius * 0.018;
  context.lineWidth = Math.max(1, radius * 0.0028);
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.002, 0, TAU);
  context.stroke();
  context.restore();
}

function projectRoute(
  route: Route,
  rotation: number,
  centerX: number,
  centerY: number,
  radius: number,
): ProjectedPoint[] {
  return route.samples.map((sample) => (
    project(sample.vector, rotation, centerX, centerY, radius, sample.lift)
  ));
}

function strokeVisibleRoute(
  context: CanvasRenderingContext2D,
  points: readonly ProjectedPoint[],
  progress: number,
) {
  const finalIndex = Math.max(1, Math.floor((points.length - 1) * progress));
  context.beginPath();
  let drawing = false;
  for (let index = 0; index <= finalIndex; index += 1) {
    const point = points[index];
    if (point.depth <= -0.035) {
      drawing = false;
      continue;
    }
    if (drawing) context.lineTo(point.x, point.y);
    else context.moveTo(point.x, point.y);
    drawing = true;
  }
  context.stroke();
}

function drawRouteTrail(
  context: CanvasRenderingContext2D,
  points: readonly ProjectedPoint[],
  progress: number,
) {
  const headIndex = Math.floor(clamp(progress) * (points.length - 1));
  const tailLength = 12;
  for (let index = Math.max(1, headIndex - tailLength); index <= headIndex; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || previous.depth <= -0.035 || point.depth <= -0.035) continue;
    const strength = (index - (headIndex - tailLength)) / tailLength;
    context.strokeStyle = `rgba(35, 133, 255, ${0.08 + strength * 0.82})`;
    context.lineWidth = 1 + strength * 2.4;
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
  const head = points[headIndex];
  if (!head || head.depth <= -0.035) return;
  context.save();
  context.shadowColor = "rgba(16, 119, 255, 0.98)";
  context.shadowBlur = 15;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(head.x, head.y, 2.8, 0, TAU);
  context.fill();
  context.restore();
}

function drawNode(
  context: CanvasRenderingContext2D,
  point: ProjectedPoint,
  radius: number,
  elapsed: number,
  phase: number,
  prominent = false,
) {
  if (point.depth <= -0.02) return;
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.0025 + phase * TAU);
  const dotRadius = Math.max(2.5, radius * (prominent ? 0.013 : 0.009));
  context.save();
  context.globalAlpha = 0.45 + clamp(point.depth) * 0.55;
  context.strokeStyle = `rgba(17, 119, 245, ${0.24 + pulse * 0.28})`;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(point.x, point.y, dotRadius * (2.2 + pulse * 1.15), 0, TAU);
  context.stroke();
  context.shadowColor = "rgba(18, 122, 249, 0.94)";
  context.shadowBlur = prominent ? 20 : 13;
  context.fillStyle = prominent ? "#0069df" : "#ffffff";
  context.strokeStyle = prominent ? "#ffffff" : "#0875eb";
  context.lineWidth = Math.max(1.3, radius * 0.004);
  context.beginPath();
  context.arc(point.x, point.y, dotRadius, 0, TAU);
  context.fill();
  context.stroke();
  context.restore();
}

function drawConnections(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  rotation: number,
  elapsed: number,
  connectionCount: number,
  reducedMotion: boolean,
) {
  const routeCount = Math.min(
    ROUTES.length,
    Math.max(4, 4 + Math.floor(Math.log2(Math.max(1, connectionCount)))),
  );

  for (let index = 0; index < routeCount; index += 1) {
    const route = ROUTES[index];
    const points = projectRoute(route, rotation, centerX, centerY, radius);
    const reveal = reducedMotion
      ? 1
      : clamp((elapsed / 1000 - 0.32 - index * 0.18) / 1.05);
    if (reveal <= 0) continue;

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = "rgba(17, 118, 245, 0.72)";
    context.shadowBlur = radius * 0.025;
    context.strokeStyle = "rgba(18, 111, 226, 0.2)";
    context.lineWidth = Math.max(2.8, radius * 0.012);
    strokeVisibleRoute(context, points, reveal);
    context.shadowBlur = radius * 0.012;
    context.strokeStyle = "rgba(18, 119, 245, 0.8)";
    context.lineWidth = Math.max(1.05, radius * 0.0044);
    strokeVisibleRoute(context, points, reveal);
    context.strokeStyle = "rgba(255, 255, 255, 0.78)";
    context.lineWidth = Math.max(0.45, radius * 0.0018);
    strokeVisibleRoute(context, points, reveal);

    const traveller = reducedMotion
      ? 0.72
      : reveal < 1
        ? reveal
        : (elapsed * 0.00012 + route.phase) % 1;
    drawRouteTrail(context, points, traveller);
    context.restore();

    const from = project(route.from, rotation, centerX, centerY, radius * 1.002);
    const to = project(route.to, rotation, centerX, centerY, radius * 1.002);
    drawNode(context, from, radius, elapsed, route.phase, index === 0);
    if (reveal > 0.9) drawNode(context, to, radius, elapsed, route.phase + 0.36);
  }
}

function renderGlobe(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
  elapsed: number,
  connectionCount: number,
  reducedMotion: boolean,
  hover: HoverPoint,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const size = Math.min(width, height);
  const radius = size * 0.37;
  const centerX = width / 2;
  const centerY = height * 0.515;
  const rotation = INITIAL_ROTATION + (reducedMotion ? 0 : elapsed * 0.000025);
  const entrance = reducedMotion ? 1 : 1 - Math.pow(1 - clamp(elapsed / 950), 3);

  context.save();
  context.globalAlpha = entrance;
  context.translate(0, radius * (1 - entrance) * 0.14);
  drawBackgroundGlow(context, centerX, centerY, radius);
  drawFloatingParticles(context, centerX, centerY, radius, elapsed, reducedMotion);
  drawSatelliteOrbits(context, centerX, centerY, radius, elapsed, reducedMotion);
  drawSphere(context, centerX, centerY, radius, rotation, elapsed, hover);
  drawGlobeOutline(context, centerX, centerY, radius);
  drawConnections(
    context,
    centerX,
    centerY,
    radius,
    rotation,
    elapsed,
    connectionCount,
    reducedMotion,
  );
  context.restore();
}

export function ResonanceGlobeCanvas({
  className,
  connectionCount = 1,
  active = true,
}: ResonanceGlobeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedAtRef = useRef<number | null>(null);
  const hoverRef = useRef<HoverPoint>({ x: 0, y: 0, active: false });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    const startedAt = startedAtRef.current ?? performance.now();
    startedAtRef.current = startedAt;
    const shouldAnimate = active && !reducedMotion;
    const count = Math.max(1, Math.round(connectionCount ?? 1));

    const resize = () => {
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      const rawDpr = Math.max(1, window.devicePixelRatio || 1);
      dpr = Math.max(0.75, Math.min(rawDpr, 2, 1800 / Math.max(width, height)));
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      if (!shouldAnimate) {
        renderGlobe(canvas, width, height, dpr, 1800, count, true, hoverRef.current);
      }
    };

    const render = (now: number) => {
      const elapsed = now - startedAt;
      renderGlobe(canvas, width, height, dpr, elapsed, count, reducedMotion, hoverRef.current);
      if (shouldAnimate) animationFrame = window.requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      hoverRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        active: true,
      };
    };
    const handlePointerLeave = () => {
      hoverRef.current = { ...hoverRef.current, active: false };
    };
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (shouldAnimate) {
      animationFrame = window.requestAnimationFrame(render);
    } else {
      renderGlobe(canvas, width, height, dpr, 1800, count, true, hoverRef.current);
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
    };
  }, [active, connectionCount, reducedMotion]);

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
    </div>
  );
}
