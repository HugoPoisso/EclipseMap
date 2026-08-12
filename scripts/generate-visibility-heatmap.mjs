#!/usr/bin/env node
// One-off offline precompute: for a grid of points across the Alpes-Maritimes
// département, estimates whether terrain blocks the view toward the sun's
// position at eclipse maximum (azimuth ~292°, altitude ~6°) on 2026-08-12,
// then rasterizes the result directly into a PNG (score -> color per pixel,
// transparent outside the département) for use as a Leaflet image overlay.
//
// A raster is used instead of a Leaflet.heat-style density heatmap on
// purpose: with heatmap libraries, color represents the *density of
// overlapping points*, not a direct value. A dense uniform grid like ours
// saturates that density almost everywhere, which just washes the whole map
// in one warm color regardless of the actual per-location score. Rendering
// our own score -> color pixels sidesteps that entirely.
//
// Not part of the app runtime/bundle — run manually, commit the result.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { point } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

const SUN_ALTITUDE_DEG = 6;
const SUN_AZIMUTH_DEG = 292;
const EYE_HEIGHT_M = 1.5;
const PROFILE_MAX_DISTANCE_M = 20000;
const PROFILE_STEP_M = 40; // ~SRTM1 native resolution (~30m) — finer adds no real information
const EARTH_RADIUS_M = 6371000;
const REFRACTION_EFFECTIVE_RADIUS_M = (7 / 6) * EARTH_RADIUS_M;
const MARGIN_SCORE_MIN_DEG = -3; // margin at/below this -> score 0
const MARGIN_SCORE_MAX_DEG = 5; // margin at/above this -> score 100

const COMPUTE_GRID_SPACING_KM = 0.2; // horizon-profile scoring resolution
const IMAGE_SUPERSAMPLE = 2; // pixels per compute cell in the output PNG (cheap upsampling)
const LOOKUP_GRID_SPACING_KM = 1; // coarser sibling grid shipped for click-to-query lookups
const OVERLAY_ALPHA = 190; // 0-255

const COLOR_STOPS = [
  { t: 0, rgb: [214, 69, 69] }, // #d64545 red
  { t: 0.5, rgb: [232, 197, 71] }, // #e8c547 yellow
  { t: 1, rgb: [63, 145, 66] }, // #3f9142 green
];

const TILE_IDS = ['N43E006', 'N43E007', 'N44E006', 'N44E007'];
const DEPT_GEOJSON_URL =
  'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements/06-alpes-maritimes/departement-06-alpes-maritimes.geojson';

const cacheDir = new URL('../.tmp-srtm/', import.meta.url);
mkdirSync(cacheDir, { recursive: true });

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function loadTile(tileId) {
  const cachePath = new URL(`${tileId}.hgt`, cacheDir);
  if (existsSync(cachePath)) {
    return parseHgt(readFileSync(cachePath));
  }
  const latPrefix = tileId.slice(0, 3);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${latPrefix}/${tileId}.hgt.gz`;
  console.log(`Downloading ${url}`);
  const gz = await fetchBuffer(url);
  const hgt = gunzipSync(gz);
  writeFileSync(cachePath, hgt);
  return parseHgt(hgt);
}

function parseHgt(buffer) {
  const size = Math.sqrt(buffer.length / 2);
  if (!Number.isInteger(size)) {
    throw new Error(`Unexpected .hgt size: ${buffer.length} bytes`);
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const data = new Int16Array(size * size);
  for (let i = 0; i < data.length; i++) {
    data[i] = view.getInt16(i * 2, false); // big-endian
  }
  return { size, data };
}

function tileIdFor(lat, lng) {
  const latT = Math.floor(lat);
  const lngT = Math.floor(lng);
  const ns = latT >= 0 ? 'N' : 'S';
  const ew = lngT >= 0 ? 'E' : 'W';
  return `${ns}${String(Math.abs(latT)).padStart(2, '0')}${ew}${String(Math.abs(lngT)).padStart(3, '0')}`;
}

function makeElevationSampler(tiles) {
  return function elevationAt(lat, lng) {
    const clampedLat = Math.min(Math.max(lat, 43), 44.9999);
    const clampedLng = Math.min(Math.max(lng, 6), 7.9999);
    const id = tileIdFor(clampedLat, clampedLng);
    const tile = tiles.get(id);
    if (!tile) return 0;
    const latT = Math.floor(clampedLat);
    const lngT = Math.floor(clampedLng);
    const { size, data } = tile;
    const rowF = (latT + 1 - clampedLat) * (size - 1);
    const colF = (clampedLng - lngT) * (size - 1);
    const r0 = Math.max(0, Math.min(size - 2, Math.floor(rowF)));
    const c0 = Math.max(0, Math.min(size - 2, Math.floor(colF)));
    const r1 = r0 + 1;
    const c1 = c0 + 1;
    const fr = rowF - r0;
    const fc = colF - c0;
    const h00 = data[r0 * size + c0];
    const h01 = data[r0 * size + c1];
    const h10 = data[r1 * size + c0];
    const h11 = data[r1 * size + c1];
    const top = h00 + (h01 - h00) * fc;
    const bottom = h10 + (h11 - h10) * fc;
    return top + (bottom - top) * fr;
  };
}

function destinationPoint(lat, lng, bearingDeg, distanceM) {
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const θ = (bearingDeg * Math.PI) / 180;
  const δ = distanceM / EARTH_RADIUS_M;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
}

function horizonClearanceScore(lat, lng, elevationAt) {
  const h0 = elevationAt(lat, lng) + EYE_HEIGHT_M;
  let maxAngleDeg = -90;
  for (let d = PROFILE_STEP_M; d <= PROFILE_MAX_DISTANCE_M; d += PROFILE_STEP_M) {
    const { lat: plat, lng: plng } = destinationPoint(lat, lng, SUN_AZIMUTH_DEG, d);
    const h = elevationAt(plat, plng);
    const drop = (d * d) / (2 * REFRACTION_EFFECTIVE_RADIUS_M);
    const angleDeg = (Math.atan2(h - h0 - drop, d) * 180) / Math.PI;
    if (angleDeg > maxAngleDeg) maxAngleDeg = angleDeg;
  }
  const margin = SUN_ALTITUDE_DEG - maxAngleDeg;
  const t = (margin - MARGIN_SCORE_MIN_DEG) / (MARGIN_SCORE_MAX_DEG - MARGIN_SCORE_MIN_DEG);
  return Math.max(0, Math.min(1, t)) * 100;
}

function scoreToColor(score) {
  const t = Math.max(0, Math.min(1, score / 100));
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].rgb;
}

function boundingBox(polygonFeature) {
  const coordsList =
    polygonFeature.geometry.type === 'Polygon'
      ? [polygonFeature.geometry.coordinates]
      : polygonFeature.geometry.coordinates;
  let minLat = 90,
    maxLat = -90,
    minLng = 180,
    maxLng = -180;
  for (const poly of coordsList) {
    for (const [lng, lat] of poly[0]) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

async function main() {
  console.log('Loading département boundary...');
  const deptRes = await fetch(DEPT_GEOJSON_URL);
  if (!deptRes.ok) throw new Error(`Failed to fetch département geojson: ${deptRes.status}`);
  const deptGeojson = await deptRes.json();
  const polygonFeature =
    deptGeojson.type === 'FeatureCollection' ? deptGeojson.features[0] : deptGeojson;

  console.log('Loading SRTM tiles...');
  const tiles = new Map();
  for (const id of TILE_IDS) {
    tiles.set(id, await loadTile(id));
  }
  const elevationAt = makeElevationSampler(tiles);

  const checkArg = process.argv.find((a) => a.startsWith('--check='));
  if (checkArg) {
    const [lat, lng] = checkArg.slice('--check='.length).split(',').map(Number);
    const score = horizonClearanceScore(lat, lng, elevationAt);
    console.log(
      `Score at (${lat}, ${lng}): ${score.toFixed(1)} — elevation ${elevationAt(lat, lng).toFixed(0)} m`,
    );
    return;
  }

  const { minLat, maxLat, minLng, maxLng } = boundingBox(polygonFeature);
  const midLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const dLat = COMPUTE_GRID_SPACING_KM / 111;
  const dLng = COMPUTE_GRID_SPACING_KM / (111 * Math.cos(midLatRad));

  const cols = Math.ceil((maxLng - minLng) / dLng) + 1;
  const rows = Math.ceil((maxLat - minLat) / dLat) + 1;
  console.log(`Compute grid: ${cols} x ${rows} = ${cols * rows} cells`);

  // scores[row][col]: null outside the département, 0-100 inside. Row 0 = north.
  const scores = Array.from({ length: rows }, () => new Array(cols).fill(null));
  let done = 0;
  const total = rows * cols;
  for (let row = 0; row < rows; row++) {
    const lat = maxLat - row * dLat;
    for (let col = 0; col < cols; col++) {
      const lng = minLng + col * dLng;
      if (booleanPointInPolygon(point([lng, lat]), polygonFeature)) {
        scores[row][col] = horizonClearanceScore(lat, lng, elevationAt);
      }
      done++;
      if (done % 1000 === 0) console.log(`  ${done}/${total}`);
    }
  }

  const validScores = scores.flat().filter((s) => s !== null);
  let min = Infinity,
    max = -Infinity,
    sum = 0;
  for (const s of validScores) {
    if (s < min) min = s;
    if (s > max) max = s;
    sum += s;
  }
  console.log(
    `Score range: min=${min.toFixed(0)} max=${max.toFixed(0)} avg=${(sum / validScores.length).toFixed(1)} (${validScores.length} cells inside département)`,
  );

  console.log('Writing click-lookup grid...');
  const lookupStride = Math.max(1, Math.round(LOOKUP_GRID_SPACING_KM / COMPUTE_GRID_SPACING_KM));
  const lookupPoints = [];
  for (let row = 0; row < rows; row += lookupStride) {
    const lat = maxLat - row * dLat;
    for (let col = 0; col < cols; col += lookupStride) {
      const score = scores[row][col];
      if (score !== null) {
        lookupPoints.push({
          lat: Math.round(lat * 1e5) / 1e5,
          lng: Math.round((minLng + col * dLng) * 1e5) / 1e5,
          score: Math.round(score),
        });
      }
    }
  }
  const lookupDir = new URL('../public/data/', import.meta.url);
  mkdirSync(lookupDir, { recursive: true });
  writeFileSync(new URL('visibility-lookup.json', lookupDir), JSON.stringify(lookupPoints));
  console.log(`Wrote ${lookupPoints.length} lookup points`);

  console.log('Rasterizing PNG...');
  const imgCols = cols * IMAGE_SUPERSAMPLE;
  const imgRows = rows * IMAGE_SUPERSAMPLE;
  const png = new PNG({ width: imgCols, height: imgRows });

  for (let py = 0; py < imgRows; py++) {
    const rowF = py / IMAGE_SUPERSAMPLE;
    const r0 = Math.min(rows - 2, Math.max(0, Math.floor(rowF)));
    const r1 = r0 + 1;
    const fr = Math.min(1, Math.max(0, rowF - r0));
    for (let px = 0; px < imgCols; px++) {
      const colF = px / IMAGE_SUPERSAMPLE;
      const c0 = Math.min(cols - 2, Math.max(0, Math.floor(colF)));
      const c1 = c0 + 1;
      const fc = Math.min(1, Math.max(0, colF - c0));

      const s00 = scores[r0][c0];
      const s01 = scores[r0][c1];
      const s10 = scores[r1][c0];
      const s11 = scores[r1][c1];

      const idx = (imgCols * py + px) << 2;
      if (s00 === null || s01 === null || s10 === null || s11 === null) {
        // Near/outside the boundary: avoid blending with "null" -> nearest neighbour, transparent if that's null.
        const nearest = fr < 0.5 ? (fc < 0.5 ? s00 : s01) : fc < 0.5 ? s10 : s11;
        if (nearest === null) {
          png.data[idx + 3] = 0;
          continue;
        }
        const [r, g, b] = scoreToColor(nearest);
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = OVERLAY_ALPHA;
        continue;
      }

      const top = s00 + (s01 - s00) * fc;
      const bottom = s10 + (s11 - s10) * fc;
      const score = top + (bottom - top) * fr;
      const [r, g, b] = scoreToColor(score);
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = OVERLAY_ALPHA;
    }
  }

  const outDir = new URL('../public/data/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const pngPath = new URL('visibility-heatmap.png', outDir);
  writeFileSync(pngPath, PNG.sync.write(png));
  console.log(`Wrote ${imgCols}x${imgRows} PNG to ${pngPath.pathname}`);

  console.log('\nBounds for L.latLngBounds in map.ts:');
  console.log(
    JSON.stringify({
      south: minLat,
      west: minLng,
      north: maxLat,
      east: maxLng,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
