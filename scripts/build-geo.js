#!/usr/bin/env node
/*
 * Builds public/geo/world.json — the geographic data the analytics globe draws.
 *
 * Sources (downloaded at build time, artifact committed):
 *   world-atlas countries-110m  → coastlines + country borders
 *   us-atlas    states-10m      → US state borders
 *
 * Output shape:
 *   {
 *     mask:    { w, h, step, bits }   land raster (base64 bitmask, row-major from lat +90)
 *     coast:   [[lon,lat, ...], ...]  coastline polylines (flat pairs)
 *     borders: [[...], ...]           internal country borders
 *     states:  [[...], ...]           internal US state borders
 *   }
 *
 * TopoJSON shares an arc between the two shapes that touch along it, so emitting
 * arcs (rather than each shape's rings) draws every border exactly once.
 *
 * Run: node scripts/build-geo.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = {
  world: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
  states: 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json',
};
const OUT = path.join(__dirname, '..', 'public', 'geo', 'world.json');

// ---- TopoJSON decoding -----------------------------------------------------
// Arcs are delta-encoded over a quantized integer grid; the transform maps that
// grid back to lon/lat.
function decodeArcs(topo) {
  const { scale, translate } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map((d) => {
      x += d[0]; y += d[1];
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}
// Every arc index a geometry references, normalized (~i means "arc i reversed").
function arcIndices(geom, out) {
  out = out || new Set();
  const walk = (a) => {
    if (typeof a === 'number') { out.add(a < 0 ? ~a : a); return; }
    if (Array.isArray(a)) a.forEach(walk);
  };
  if (geom.type === 'GeometryCollection') geom.geometries.forEach((g) => walk(g.arcs));
  else walk(geom.arcs);
  return out;
}
// Stitch a geometry's arcs into closed rings of [lon,lat] points.
function ringsOf(geom, arcs, out) {
  out = out || [];
  const ring = (idxs) => {
    const pts = [];
    idxs.forEach((i) => {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      // consecutive arcs repeat the shared endpoint
      pts.push.apply(pts, pts.length ? a.slice(1) : a);
    });
    if (pts.length > 2) out.push(pts);
  };
  const walk = (g) => {
    if (g.type === 'GeometryCollection') { g.geometries.forEach(walk); return; }
    if (g.type === 'Polygon') g.arcs.forEach(ring);
    else if (g.type === 'MultiPolygon') g.arcs.forEach((poly) => poly.forEach(ring));
  };
  walk(geom);
  return out;
}

// ---- simplification --------------------------------------------------------
// Drop points that add no visible shape at globe scale, then round to ~1km.
function simplify(pts, eps) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (Math.abs(p[0] - q[0]) > eps || Math.abs(p[1] - q[1]) > eps) out.push(p);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  return out;
}
const r2 = (n) => Math.round(n * 100) / 100;
// Flatten to [lon,lat,lon,lat,...] — half the JSON of nested pairs.
function flatten(lines, eps) {
  const out = [];
  for (const l of lines) {
    const s = simplify(l, eps);
    if (s.length < 2) continue;
    const flat = [];
    for (const p of s) { flat.push(r2(p[0]), r2(p[1])); }
    out.push(flat);
  }
  return out;
}

// ---- land raster -----------------------------------------------------------
// Scanline fill: for each row's latitude, collect every ring edge crossing it,
// sort the longitudes, and fill between pairs (even-odd handles holes).
function buildMask(rings, step) {
  const w = Math.round(360 / step), h = Math.round(180 / step);
  const bits = Buffer.alloc(Math.ceil((w * h) / 8));
  for (let row = 0; row < h; row++) {
    const lat = 90 - (row + 0.5) * step;
    const xs = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a[1] > lat) === (b[1] > lat)) continue;
        xs.push(a[0] + ((lat - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (!xs.length) continue;
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] + 180) / step - 0.5));
      const c1 = Math.min(w - 1, Math.floor((xs[k + 1] + 180) / step - 0.5));
      for (let c = c0; c <= c1; c++) {
        const bit = row * w + c;
        bits[bit >> 3] |= 128 >> (bit & 7);
      }
    }
  }
  return { w, h, step, bits: bits.toString('base64') };
}

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.json();
}

(async () => {
  const world = await get(SRC.world);
  const states = await get(SRC.states);

  const wArcs = decodeArcs(world);
  const landIdx = arcIndices(world.objects.land);
  const coastLines = [], borderLines = [];
  wArcs.forEach((a, i) => (landIdx.has(i) ? coastLines : borderLines).push(a));

  // US state borders minus the national outline (that's already the coastline).
  const sArcs = decodeArcs(states);
  const nationIdx = arcIndices(states.objects.nation);
  const stateLines = sArcs.filter((a, i) => !nationIdx.has(i));

  const landRings = ringsOf(world.objects.land, wArcs);
  const mask = buildMask(landRings, 0.5);

  const data = {
    mask,
    coast: flatten(coastLines, 0.08),
    borders: flatten(borderLines, 0.1),
    states: flatten(stateLines, 0.1),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(data);
  fs.writeFileSync(OUT, json);
  const gz = zlib.gzipSync(Buffer.from(json)).length;
  const pts = (a) => a.reduce((n, l) => n + l.length / 2, 0);
  console.log(
    'geo built: %s (%dkB raw, ~%dkB gzip)\n  mask %dx%d @%s°\n  coast %d lines / %d pts\n  borders %d / %d\n  states %d / %d',
    path.relative(process.cwd(), OUT), Math.round(json.length / 1024), Math.round(gz / 1024),
    mask.w, mask.h, mask.step,
    data.coast.length, pts(data.coast), data.borders.length, pts(data.borders),
    data.states.length, pts(data.states)
  );
})().catch((e) => { console.error('build-geo failed:', e.message); process.exit(1); });
