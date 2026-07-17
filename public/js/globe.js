(function () {
  'use strict';
  var canvas = document.getElementById('trafficGlobe');
  if (!canvas || !canvas.getContext) return;

  // Country centroids: ISO-3166 alpha-2 -> [lat, lon, name].
  var COORDS = {
    US: [39.8, -98.6, 'United States'], CA: [56.1, -106.3, 'Canada'], MX: [23.6, -102.5, 'Mexico'],
    BR: [-14.2, -51.9, 'Brazil'], AR: [-38.4, -63.6, 'Argentina'], CL: [-35.7, -71.5, 'Chile'], CO: [4.6, -74.3, 'Colombia'], PE: [-9.2, -75, 'Peru'],
    GB: [54.4, -2.4, 'United Kingdom'], IE: [53.4, -8, 'Ireland'], FR: [46.2, 2.2, 'France'], DE: [51.2, 10.4, 'Germany'], ES: [40.5, -3.7, 'Spain'], PT: [39.4, -8.2, 'Portugal'],
    IT: [42.8, 12.6, 'Italy'], NL: [52.1, 5.3, 'Netherlands'], BE: [50.5, 4.5, 'Belgium'], CH: [46.8, 8.2, 'Switzerland'], AT: [47.5, 14.6, 'Austria'],
    SE: [62.1, 15.6, 'Sweden'], NO: [62.5, 9.5, 'Norway'], FI: [64.9, 25.7, 'Finland'], DK: [56.0, 9.5, 'Denmark'], PL: [51.9, 19.1, 'Poland'],
    CZ: [49.8, 15.5, 'Czechia'], RO: [45.9, 24.9, 'Romania'], GR: [39.1, 22.8, 'Greece'], UA: [48.4, 31.2, 'Ukraine'], RU: [61.5, 90.3, 'Russia'], TR: [39, 35.2, 'Turkey'],
    IN: [22.6, 79.9, 'India'], CN: [35.9, 104.2, 'China'], JP: [37.2, 138.3, 'Japan'], KR: [36.4, 127.8, 'South Korea'], ID: [-2.5, 118.0, 'Indonesia'],
    PH: [12.9, 122.8, 'Philippines'], TH: [15.9, 100.9, 'Thailand'], VN: [16.1, 107.8, 'Vietnam'], MY: [4.2, 102.5, 'Malaysia'], SG: [1.35, 103.8, 'Singapore'],
    PK: [30.4, 69.3, 'Pakistan'], BD: [23.7, 90.4, 'Bangladesh'], AE: [24.0, 54.0, 'UAE'], SA: [24.9, 45.1, 'Saudi Arabia'], IL: [31.4, 35.0, 'Israel'],
    ZA: [-29.0, 24.9, 'South Africa'], NG: [9.6, 8.1, 'Nigeria'], EG: [26.8, 30.0, 'Egypt'], KE: [0.2, 37.9, 'Kenya'], MA: [32.0, -6.1, 'Morocco'],
    AU: [-25.3, 134.0, 'Australia'], NZ: [-42.0, 172.9, 'New Zealand']
  };
  var data = (window.GLOBE_DATA || []).filter(function (c) { return COORDS[c.country]; });

  // Markers: prefer Cloudflare's exact per-visitor city coordinates when present
  // (each { country, city, lat, lon, n }); otherwise fall back to country
  // centroids so the globe still shows origin even without the geo transform.
  var cityData = (window.GLOBE_CITIES || []).filter(function (c) {
    return typeof c.lat === 'number' && typeof c.lon === 'number';
  });
  var MARKERS, markerMax = 1, cityMode = cityData.length > 0;
  if (cityMode) {
    MARKERS = cityData.map(function (c) {
      var label = c.city || (COORDS[c.country] && COORDS[c.country][2]) || c.country || 'Unknown';
      return { lat: c.lat, lon: c.lon, n: c.n, label: label, country: c.country, key: c.lat + ',' + c.lon };
    });
  } else {
    MARKERS = data.map(function (c) {
      var co = COORDS[c.country];
      return { lat: co[0], lon: co[1], n: c.n, label: co[2], country: c.country, key: c.country };
    });
  }
  MARKERS.forEach(function (m) { if (m.n > markerMax) markerMax = m.n; });

  // Major cities — rendered as warm "night-side lights" for extra surface detail.
  var CITIES = [
    [40.7, -74], [34, -118.2], [41.9, -87.6], [29.8, -95.4], [19.4, -99.1], [25.8, -80.2],
    [-23.5, -46.6], [-34.6, -58.4], [4.7, -74.1], [-12, -77], [-33.4, -70.7], [43.7, -79.4], [49.3, -123.1],
    [51.5, -0.1], [48.9, 2.35], [52.5, 13.4], [40.4, -3.7], [41.9, 12.5], [52.4, 4.9], [59.3, 18], [59.9, 10.7],
    [55.75, 37.6], [50.1, 14.4], [48.2, 16.4], [41, 28.9], [37.98, 23.7],
    [28.6, 77.2], [19, 72.8], [23.8, 90.4], [24.9, 67], [39.9, 116.4], [31.2, 121.5], [22.3, 114.2],
    [35.7, 139.7], [37.5, 127], [1.35, 103.8], [-6.2, 106.8], [13.75, 100.5], [14.6, 121], [21, 105.8],
    [-33.9, 151.2], [-37.8, 144.9], [-36.85, 174.8],
    [30, 31.2], [6.5, 3.4], [-26.2, 28], [-1.3, 36.8], [33.6, -7.6], [25.2, 55.3], [24.7, 46.7], [31.8, 35.2]
  ];

  // ---- real geography, loaded from /assets/geo/world.json --------------------
  // Land is a 0.5° raster bitmask (drawn as dots, which handles the sphere's
  // horizon naturally); coastlines, country borders and US state borders are
  // polylines stroked with per-segment horizon culling. Built by
  // scripts/build-geo.js from world-atlas + us-atlas.
  var GEO = null, mask = null, maskBits = null, lodCache = {};

  function maskAt(lat, lon) {
    if (!maskBits) return false;
    var row = Math.floor((90 - lat) / mask.step);
    var col = Math.floor((lon + 180) / mask.step);
    if (row < 0 || row >= mask.h) return false;
    col = ((col % mask.w) + mask.w) % mask.w;      // wrap the antimeridian
    var b = row * mask.w + col;
    return (maskBits[b >> 3] & (128 >> (b & 7))) !== 0;
  }
  function b64ToBytes(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Rough arid regions, so deserts read tan instead of green.
  function isDesert(lat, lon) {
    if (lat > 12 && lat < 33 && lon > -12 && lon < 52) return true;    // Sahara + Arabia
    if (lat > 25 && lat < 42 && lon > 55 && lon < 78) return true;     // Iran / Central Asia
    if (lat > -30 && lat < -19 && lon > 118 && lon < 141) return true; // Australian outback
    if (lat > 30 && lat < 42 && lon > -116 && lon < -104) return true; // US Southwest
    if (lat > -27 && lat < -16 && lon > -71 && lon < -64) return true; // Atacama
    return false;
  }
  function noise(lat, lon) {
    var s = Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  var BIOME = { g: [104, 196, 138], t: [86, 200, 120], b: [120, 176, 150], d: [206, 186, 120] };

  // Sample the mask into drawable dots at a given spacing. Coarser when zoomed
  // out (fewer, larger dots), finer as you zoom in — so detail scales with the
  // pixels actually available. Cached per level.
  function landPtsFor(step) {
    var key = String(step);
    if (lodCache[key]) return lodCache[key];
    var pts = [];
    for (var la = -89; la <= 84; la += step) {
      var stepLon = Math.max(step, step / Math.max(0.18, Math.cos(la * Math.PI / 180)));
      for (var lo = -180; lo < 180; lo += stepLon) {
        if (!maskAt(la, lo)) continue;
        var coastal = !maskAt(la + step, lo) || !maskAt(la - step, lo)
          || !maskAt(la, lo + stepLon) || !maskAt(la, lo - stepLon);
        var alat = Math.abs(la), biome;
        if (isDesert(la, lo)) biome = 'd';
        else if (alat > 58) biome = 'b';
        else if (alat < 23) biome = 't';
        else biome = 'g';
        pts.push([la, lo, coastal ? 1 : 0, biome, noise(la, lo)]);
      }
    }
    lodCache[key] = pts;
    return pts;
  }
  function lodStep() {
    if (zoom >= 3) return 0.6;
    if (zoom >= 1.8) return 0.9;
    return 1.5;
  }

  // Polar ice caps — Antarctica and the Arctic sheet, pale blue-white.
  var icePts = [];
  for (var ila = -90; ila <= -64; ila += 2.2) {
    var isl = Math.max(2.2, 2.2 / Math.max(0.12, Math.cos(ila * Math.PI / 180)));
    for (var ilo = -180; ilo < 180; ilo += isl) icePts.push([ila, ilo]);
  }
  for (var ala = 73; ala <= 90; ala += 2.4) {
    var asl = Math.max(2.4, 2.4 / Math.max(0.1, Math.cos(ala * Math.PI / 180)));
    for (var alo = -180; alo < 180; alo += asl) icePts.push([ala, alo]);
  }

  var ctx = canvas.getContext('2d');
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, R = 0, cx = 0, cy = 0;
  function resize() {
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    R = Math.min(W, H) / 2 - 14; cx = W / 2; cy = H / 2;
  }

  // Static starfield (screen-space, drawn behind the globe).
  var stars = [];
  (function () {
    for (var i = 0; i < 70; i++) stars.push([Math.random(), Math.random(), 0.3 + Math.random() * 0.7, Math.random() * 6.28]);
  })();

  // View tilt is adjustable (vertical drag) so you can bring either pole into
  // view; zoom magnifies the sphere so specific spots can be inspected closely.
  var TILT = 20 * Math.PI / 180, viewTilt = TILT, cosT = Math.cos(viewTilt), sinT = Math.sin(viewTilt);
  var zoom = 1, Rz = 0;
  function project(latDeg, lonDeg, rot) {
    var lat = latDeg * Math.PI / 180, lon = (lonDeg + rot) * Math.PI / 180;
    var x = Math.cos(lat) * Math.sin(lon);
    var y = Math.sin(lat);
    var z = Math.cos(lat) * Math.cos(lon);
    var y2 = y * cosT - z * sinT;
    var z2 = y * sinT + z * cosT;
    return { sx: cx + x * Rz, sy: cy - y2 * Rz, z: z2 };
  }

  var rot = 0, raf = null, t = 0, stopped = false;

  // ---- interaction: drag to spin/tilt, wheel to zoom, hover for detail ------
  var drag = null, spin = 0.16, hover = null, mouse = null;
  function localPt(e) {
    var r = canvas.getBoundingClientRect();
    var p = (e.touches && e.touches[0]) || e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  var MIN_TILT = -78 * Math.PI / 180, MAX_TILT = 78 * Math.PI / 180;
  var MIN_ZOOM = 1, MAX_ZOOM = 4.5;
  function onDown(e) { var p = localPt(e); drag = { x: p.x, y: p.y, rot: rot, tilt: viewTilt }; canvas.classList.add('is-drag'); }
  function onMove(e) {
    mouse = localPt(e);
    if (drag) {
      rot = drag.rot + (mouse.x - drag.x) * (0.55 / zoom);
      viewTilt = Math.max(MIN_TILT, Math.min(MAX_TILT, drag.tilt + (mouse.y - drag.y) * (0.006 / zoom)));
      e.preventDefault && e.preventDefault();
    }
  }
  function onUp() { drag = null; canvas.classList.remove('is-drag'); }
  function setZoom(z) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    if (zoom <= MIN_ZOOM + 0.001) zoom = MIN_ZOOM;
    updateZoomUi();
  }
  function onWheel(e) { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.0016)); }
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', function () { mouse = null; onUp(); });
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('touchstart', onDown, { passive: true });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp);
  var pinch = null;
  canvas.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pinch = { d: touchDist(e), z: zoom }; }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    if (pinch && e.touches.length === 2) { setZoom(pinch.z * (touchDist(e) / pinch.d)); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) { if (e.touches.length < 2) pinch = null; });
  function touchDist(e) { var a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  // Keyboard: the canvas is focusable, so arrows spin/tilt and +/- zoom.
  canvas.setAttribute('tabindex', '0');
  canvas.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft') rot -= 6 / zoom; else if (k === 'ArrowRight') rot += 6 / zoom;
    else if (k === 'ArrowUp') viewTilt = Math.max(MIN_TILT, viewTilt - 0.06);
    else if (k === 'ArrowDown') viewTilt = Math.min(MAX_TILT, viewTilt + 0.06);
    else if (k === '+' || k === '=') setZoom(zoom * 1.35);
    else if (k === '-' || k === '_') setZoom(zoom / 1.35);
    else if (k === '0') { setZoom(1); viewTilt = TILT; }
    else return;
    e.preventDefault();
  });

  // On-canvas zoom controls (+ / − / reset) + a live scale readout.
  var zoomReadout = null;
  (function buildZoomUi() {
    var host = canvas.parentNode; if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var box = document.createElement('div'); box.className = 'globe-zoom';
    var mk = function (txt, tip) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'globe-zoom-btn'; b.textContent = txt;
      b.setAttribute('aria-label', tip); b.setAttribute('data-tip', tip); b.setAttribute('data-tip-pos', 'top');
      return b;
    };
    var bIn = mk('+', 'Zoom in'), bOut = mk('−', 'Zoom out'), bReset = mk('⤿', 'Reset view');
    zoomReadout = document.createElement('span'); zoomReadout.className = 'globe-zoom-rd'; zoomReadout.textContent = '1.0×';
    bIn.addEventListener('click', function () { setZoom(zoom * 1.35); });
    bOut.addEventListener('click', function () { setZoom(zoom / 1.35); });
    bReset.addEventListener('click', function () { setZoom(1); viewTilt = TILT; });
    box.appendChild(bIn); box.appendChild(bOut); box.appendChild(bReset); box.appendChild(zoomReadout);
    host.appendChild(box);
  })();
  function updateZoomUi() {
    if (zoomReadout) zoomReadout.textContent = zoom.toFixed(1) + '×';
    var legend = document.querySelector('.globe-legend-states');
    if (legend) legend.classList.toggle('is-on', zoom >= STATE_ZOOM);
  }

  function drawGraticule() {
    var lat, lon, p;
    for (lon = -180; lon < 180; lon += 30) {
      for (lat = -80; lat <= 80; lat += 4) {
        p = project(lat, lon, rot);
        if (p.z <= 0.03) continue;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 0.55, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,236,200,' + (0.05 + p.z * 0.06).toFixed(3) + ')'; ctx.fill();
      }
    }
    for (lat = -60; lat <= 80; lat += 20) {
      for (lon = -180; lon < 180; lon += 4) {
        p = project(lat, lon, rot);
        if (p.z <= 0.03) continue;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 0.55, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,236,200,' + (0.05 + p.z * 0.06).toFixed(3) + ')'; ctx.fill();
      }
    }
  }

  // Stroke flat [lon,lat,...] polylines, breaking the path wherever the line
  // crosses the horizon so nothing is drawn across the back of the globe.
  function drawLines(lines, color, width, minZ) {
    if (!lines) return;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < lines.length; i++) {
      var f = lines[i], pen = false;
      for (var j = 0; j < f.length; j += 2) {
        var p = project(f[j + 1], f[j], rot);
        if (p.z <= minZ) { pen = false; continue; }
        if (pen) ctx.lineTo(p.sx, p.sy); else { ctx.moveTo(p.sx, p.sy); pen = true; }
      }
    }
    ctx.stroke();
  }

  var STATE_ZOOM = 1.5;   // state borders fade in past this zoom

  function draw() {
    if (stopped) return;
    if (!document.body.contains(canvas)) { stopped = true; raf = null; return; }
    t++;
    if (!drag && zoom <= 1.02) rot += spin;   // auto-spin only when not zoomed/held
    cosT = Math.cos(viewTilt); sinT = Math.sin(viewTilt);
    Rz = R * zoom;
    var hot = null;
    ctx.clearRect(0, 0, W, H);

    // starfield
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      var tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.02 + st[3]));
      ctx.beginPath(); ctx.arc(st[0] * W, st[1] * H, st[2], 0, 6.2832);
      ctx.fillStyle = 'rgba(255,240,214,' + (tw * 0.5).toFixed(3) + ')'; ctx.fill();
    }

    // atmosphere glow
    var atm = ctx.createRadialGradient(cx, cy, Rz * 0.86, cx, cy, Rz * 1.22);
    atm.addColorStop(0, 'rgba(255,178,60,0)');
    atm.addColorStop(0.55, 'rgba(255,168,40,0.10)');
    atm.addColorStop(1, 'rgba(255,150,20,0)');
    ctx.beginPath(); ctx.arc(cx, cy, Rz * 1.22, 0, 6.2832); ctx.fillStyle = atm; ctx.fill();

    // ocean sphere — layered blue for depth
    var grad = ctx.createRadialGradient(cx - Rz * 0.4, cy - Rz * 0.45, Rz * 0.1, cx, cy, Rz);
    grad.addColorStop(0, 'rgba(78,132,190,0.34)');
    grad.addColorStop(0.45, 'rgba(44,92,150,0.24)');
    grad.addColorStop(0.78, 'rgba(24,58,104,0.24)');
    grad.addColorStop(1, 'rgba(5,18,38,0.34)');
    ctx.beginPath(); ctx.arc(cx, cy, Rz, 0, 6.2832); ctx.fillStyle = grad; ctx.fill();

    // terminator shading (day/night)
    var term = ctx.createLinearGradient(cx - Rz, cy, cx + Rz, cy);
    term.addColorStop(0, 'rgba(0,0,0,0.28)');
    term.addColorStop(0.4, 'rgba(0,0,0,0.04)');
    term.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, Rz, 0, 6.2832); ctx.clip();
    ctx.fillStyle = term; ctx.fillRect(cx - Rz, cy - Rz, Rz * 2, Rz * 2);
    ctx.restore();

    drawGraticule();

    // land: biome-tinted dots sampled from the real land raster
    if (maskBits) {
      var step = lodStep(), pts = landPtsFor(step);
      var dotScale = (step >= 1.4 ? 1 : step >= 0.85 ? 0.78 : 0.6) * (1 + 0.35 * Math.min(zoom - 1, 2.4));
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var p = project(pt[0], pt[1], rot);
        if (p.z <= 0.02) continue;
        var coastal = pt[2], col = BIOME[pt[3]] || BIOME.g, mott = 0.82 + pt[4] * 0.36;
        var a = (coastal ? 0.26 : 0.15) + p.z * (coastal ? 0.55 : 0.44);
        var rr = ((coastal ? 1.0 : 0.82) + p.z * 0.8) * dotScale;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, rr, 0, 6.2832);
        ctx.fillStyle = 'rgba(' + Math.min(255, Math.round(col[0] * (coastal ? 1.28 : mott)))
          + ',' + Math.min(255, Math.round(col[1] * (coastal ? 1.12 : mott)))
          + ',' + Math.min(255, Math.round(col[2] * (coastal ? 1.18 : mott)))
          + ',' + a.toFixed(3) + ')';
        ctx.fill();
      }
    }

    // polar ice caps
    for (var k = 0; k < icePts.length; k++) {
      var ip = project(icePts[k][0], icePts[k][1], rot);
      if (ip.z <= 0.02) continue;
      ctx.beginPath(); ctx.arc(ip.sx, ip.sy, 1.1 + ip.z * 1.0, 0, 6.2832);
      ctx.fillStyle = 'rgba(232,244,255,' + (0.35 + ip.z * 0.55).toFixed(3) + ')'; ctx.fill();
    }

    // real borders: US states (only when zoomed), country lines, then coastline
    if (GEO) {
      if (zoom >= STATE_ZOOM) {
        var sa = Math.min(1, (zoom - STATE_ZOOM) / 0.6);
        drawLines(GEO.states, 'rgba(190,225,205,' + (0.20 * sa).toFixed(3) + ')', 0.6, 0.06);
      }
      drawLines(GEO.borders, 'rgba(210,235,215,0.30)', 0.7, 0.05);
      drawLines(GEO.coast, 'rgba(168,236,190,0.72)', 1.0, 0.04);
    }

    // city lights — warm points, brighter toward the terminator
    for (var ci = 0; ci < CITIES.length; ci++) {
      var cp = project(CITIES[ci][0], CITIES[ci][1], rot);
      if (cp.z <= 0.04) continue;
      var dusk = 0.55 + 0.45 * (1 - cp.z);
      var tw2 = 0.6 + 0.4 * Math.sin(t * 0.05 + ci * 1.7);
      var ca = (0.20 + cp.z * 0.30) * dusk * tw2;
      var cg = ctx.createRadialGradient(cp.sx, cp.sy, 0, cp.sx, cp.sy, 3.2);
      cg.addColorStop(0, 'rgba(255,226,150,' + Math.min(0.9, ca * 1.8).toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, 3.2, 0, 6.2832); ctx.fillStyle = cg; ctx.fill();
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, 0.7, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,240,205,' + Math.min(0.95, ca * 2.2).toFixed(3) + ')'; ctx.fill();
    }

    // specular sun glint
    var sunx = cx - Rz * 0.42, suny = cy - Rz * 0.46;
    var sg = ctx.createRadialGradient(sunx, suny, 0, sunx, suny, Rz * 0.5);
    sg.addColorStop(0, 'rgba(255,255,240,0.16)');
    sg.addColorStop(1, 'rgba(255,255,240,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, Rz, 0, 6.2832); ctx.clip();
    ctx.beginPath(); ctx.arc(sunx, suny, Rz * 0.5, 0, 6.2832); ctx.fillStyle = sg; ctx.fill();
    ctx.restore();

    // limb darkening + rim light
    var limb = ctx.createRadialGradient(cx, cy, Rz * 0.62, cx, cy, Rz);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(2,6,16,0.45)');
    ctx.beginPath(); ctx.arc(cx, cy, Rz, 0, 6.2832); ctx.fillStyle = limb; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, Rz, 0, 6.2832);
    ctx.strokeStyle = 'rgba(255,236,200,0.22)'; ctx.lineWidth = 1.1; ctx.stroke();

    // traffic markers + arcs to the busiest hub
    var hubP = MARKERS.length ? project(MARKERS[0].lat, MARKERS[0].lon, rot) : null;
    var showLabels = zoom >= 1.9;
    // Labels are placed busiest-first (MARKERS arrives ordered by count) and any
    // that would collide with one already placed is dropped, so clusters like
    // Ashburn/Washington don't pile into an unreadable smear.
    var labelRects = [];
    function labelFits(x, y, w, h) {
      for (var i = 0; i < labelRects.length; i++) {
        var r = labelRects[i];
        if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return false;
      }
      labelRects.push({ x: x, y: y, w: w, h: h });
      return true;
    }
    MARKERS.forEach(function (c, idx) {
      var p = project(c.lat, c.lon, rot);
      if (p.z <= 0) return;
      var rad = 2 + 5 * Math.sqrt(c.n / markerMax);
      var pulse = 1 + 0.35 * Math.sin(t * 0.06 + (c.key.charCodeAt(0) || idx));
      var alpha = 0.35 + p.z * 0.6;
      if (hubP && idx > 0 && hubP.z > 0) {
        var mx = (p.sx + hubP.sx) / 2, my = (p.sy + hubP.sy) / 2;
        var lift = 26 + 10 * Math.sin(t * 0.03 + idx);
        ctx.beginPath();
        ctx.moveTo(hubP.sx, hubP.sy);
        ctx.quadraticCurveTo(mx, my - lift, p.sx, p.sy);
        ctx.strokeStyle = 'rgba(255,190,90,' + (0.12 * alpha).toFixed(3) + ')';
        ctx.lineWidth = 1; ctx.stroke();
      }
      var isHot = mouse && Math.hypot(mouse.x - p.sx, mouse.y - p.sy) < Math.max(9, rad + 5);
      if (isHot) hot = { c: c, p: p, rad: rad };
      var ringT = (t * 0.012 + idx * 0.22) % 1;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad + ringT * 22, 0, 6.2832);
      ctx.strokeStyle = 'rgba(255,190,90,' + ((1 - ringT) * 0.28 * alpha).toFixed(3) + ')';
      ctx.lineWidth = 1.2; ctx.stroke();
      var hg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad * 3.4 * pulse);
      hg.addColorStop(0, 'rgba(255,162,0,' + ((isHot ? 0.5 : 0.30) * alpha).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(255,162,0,0)');
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad * 3.4 * pulse, 0, 6.2832); ctx.fillStyle = hg; ctx.fill();
      ctx.beginPath(); ctx.arc(p.sx, p.sy, isHot ? rad + 1.5 : rad, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,' + (isHot ? 225 : 196) + ',' + (isHot ? 140 : 70) + ',' + alpha.toFixed(3) + ')'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.sx, p.sy, isHot ? rad + 1.5 : rad, 0, 6.2832);
      ctx.strokeStyle = 'rgba(255,255,255,' + ((isHot ? 0.95 : 0.55) * alpha).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
      if (showLabels && !isHot && p.z > 0.25) {
        ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        var lw = ctx.measureText(c.label).width;
        var lx = p.sx + rad + 4, ly = p.sy - 5;
        if (labelFits(lx, ly, lw, 11)) {
          // a dark plate keeps the text readable over land dots
          ctx.fillStyle = 'rgba(10,8,4,0.55)';
          ctx.fillRect(lx - 2, ly, lw + 4, 11);
          ctx.fillStyle = 'rgba(255,236,200,' + (0.55 + p.z * 0.4).toFixed(3) + ')';
          ctx.fillText(c.label, lx, ly + 8.5);
        }
      }
    });

    // hovered marker gets a floating label
    if (hot) {
      var label = hot.c.label + (hot.c.country ? ' (' + hot.c.country + ')' : '') + ' · ' + hot.c.n + (hot.c.n === 1 ? ' visitor' : ' visitors');
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      var tw3 = ctx.measureText(label).width, pad = 7;
      var bx = Math.min(Math.max(hot.p.sx - tw3 / 2 - pad, 4), W - tw3 - pad * 2 - 4);
      var by = hot.p.sy - hot.rad - 26;
      if (by < 4) by = hot.p.sy + hot.rad + 8;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw3 + pad * 2, 19, 6); else ctx.rect(bx, by, tw3 + pad * 2, 19);
      ctx.fillStyle = 'rgba(10,8,4,0.88)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,190,90,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,232,190,0.98)';
      ctx.fillText(label, bx + pad, by + 13);
      canvas.style.cursor = 'pointer';
    } else if (!drag) canvas.style.cursor = 'grab';

    raf = requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function start() { if (!raf && !stopped) draw(); }
  function draw2static() { stopped = false; draw(); stopped = true; raf = null; }
  if (reduce) { rot = 24; stopped = true; draw2static(); }
  else start();

  // Geography loads after first paint: the ocean, markers and controls are live
  // immediately, and the land/borders fade in when the data arrives.
  fetch(canvas.getAttribute('data-geo') || '/assets/geo/world.json', { cache: 'force-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.mask) return;
      GEO = d; mask = d.mask; maskBits = b64ToBytes(d.mask.bits);
      canvas.classList.add('geo-ready');
      if (reduce && stopped) draw2static();
    })
    .catch(function () { /* markers still render without the basemap */ });

  function onVis() {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (!reduce && !stopped) { if (!document.body.contains(canvas)) return; start(); }
  }
  document.addEventListener('visibilitychange', onVis);
  if (window.pjaxRegister) window.pjaxRegister(function () {
    stopped = true; if (raf) { cancelAnimationFrame(raf); raf = null; }
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', resize);
  });

  // build the side list — exact cities when available, else countries
  var list = document.getElementById('globeList');
  if (list) {
    if (!MARKERS.length) {
      list.innerHTML = '<li class="muted small">No location data yet. Visitor origin appears once traffic arrives through Cloudflare.</li>';
    } else {
      var rows = MARKERS.slice().sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
      list.innerHTML = rows.map(function (c) {
        var pct = Math.round(c.n / markerMax * 100);
        var flg = /^[A-Z]{2}$/.test(c.country) ? flag(c.country) : '📍';
        var esc = String(c.label).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
        return '<li class="globe-row"><span class="globe-flag">' + flg + '</span><span class="globe-name">' + esc + '</span>'
          + '<span class="globe-bar"><span style="width:' + pct + '%"></span></span><span class="globe-n">' + c.n + '</span></li>';
      }).join('');
    }
  }
  function flag(cc) {
    return cc.replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); });
  }
})();
