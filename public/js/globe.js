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

  // ---- Coarse continent outlines (lat/lon polygons). Filled into a dot map. ----
  var LAND = [
    // North America — Alaska, west coast, Mexico, Gulf, east coast, Canada, Arctic
    [[71,-156],[70,-160],[68,-166],[66,-164],[65,-168],[63,-165],[60,-166],[59,-160],[58,-158],[59,-153],[60,-148],[59,-141],[57,-135],[54,-131],[50,-128],[48,-125],[44,-124],[40,-124],[36,-122],[34,-120],[32,-117],[30,-116],[28,-114],[25,-112],[23,-110],[23,-106],[21,-106],[19,-105],[16,-98],[15,-94],[18,-94],[18,-96],[21,-97],[25,-97],[26,-92],[30,-89],[30,-84],[27,-80],[25,-81],[29,-83],[31,-81],[33,-79],[35,-76],[37,-76],[39,-74],[41,-72],[43,-70],[45,-66],[47,-60],[50,-57],[52,-56],[52,-62],[55,-61],[58,-63],[60,-65],[62,-70],[63,-78],[66,-73],[68,-66],[70,-68],[69,-82],[72,-84],[73,-95],[74,-105],[74,-120],[73,-128],[72,-140],[71,-150],[71,-156]],
    // Greenland
    [[83,-32],[81,-14],[77,-18],[73,-21],[70,-22],[66,-34],[62,-42],[60,-45],[63,-50],[67,-53],[72,-55],[76,-59],[79,-56],[81,-42],[83,-32]],
    // Central America (isthmus)
    [[18,-95],[17,-92],[15,-88],[13,-87],[11,-85],[9,-83],[8,-80],[8,-77],[10,-84],[13,-88],[15,-90],[16,-93],[18,-95]],
    // South America — Caribbean coast, Brazil bulge, Argentina, Patagonia, Chile, Peru
    [[12,-71],[11,-64],[9,-60],[5,-52],[1,-50],[-2,-44],[-5,-39],[-8,-35],[-13,-39],[-18,-40],[-23,-43],[-27,-49],[-31,-51],[-34,-54],[-38,-57],[-41,-62],[-45,-66],[-50,-69],[-53,-71],[-55,-67],[-52,-73],[-47,-75],[-42,-74],[-37,-73],[-30,-71],[-24,-70],[-18,-70],[-14,-76],[-8,-79],[-4,-81],[0,-80],[2,-78],[6,-77],[9,-75],[11,-72],[12,-71]],
    // Africa — Med coast, Horn, East coast, Cape, West coast, bulge
    [[37,10],[33,11],[31,20],[31,25],[30,32],[27,34],[22,37],[15,40],[12,43],[11,48],[9,51],[4,48],[-1,42],[-7,40],[-11,40],[-16,37],[-20,35],[-25,34],[-29,31],[-34,26],[-34,19],[-31,17],[-27,15],[-23,15],[-17,12],[-11,13],[-5,10],[0,9],[4,8],[5,3],[4,-3],[7,-9],[10,-14],[15,-17],[19,-16],[24,-15],[27,-12],[31,-10],[34,-6],[36,-3],[37,10]],
    // Madagascar
    [[-12,49],[-15,50],[-20,49],[-25,47],[-25,44],[-21,43],[-16,44],[-13,48],[-12,49]],
    // Scandinavia
    [[71,26],[70,31],[68,40],[65,41],[62,32],[60,25],[58,20],[57,16],[59,11],[58,6],[61,5],[63,11],[65,13],[68,15],[70,20],[71,26]],
    // Europe — Iberia, France, Italy, Balkans, Black Sea, into Russia
    [[43,-9],[41,-9],[38,-9],[36,-6],[37,-2],[39,0],[42,3],[43,7],[44,10],[40,15],[38,16],[40,19],[42,19],[41,16],[45,13],[45,30],[46,37],[45,40],[48,38],[50,40],[54,52],[58,55],[60,50],[59,42],[57,38],[54,32],[54,20],[54,14],[51,4],[49,0],[48,-4],[43,-2],[43,-9]],
    // Great Britain + Ireland
    [[58,-5],[57,-2],[54,-1],[52,1],[51,1],[50,-1],[50,-5],[52,-5],[55,-6],[58,-5]],
    [[55,-8],[54,-6],[52,-6],[51,-10],[53,-10],[55,-8]],
    // Asia — Ural/Siberia to Bering, Kamchatka, China, SE Asia, India, Middle East, back to Urals
    [[66,45],[68,55],[71,68],[73,80],[76,95],[73,105],[72,113],[70,128],[73,140],[69,170],[64,177],[60,163],[62,155],[59,150],[56,143],[52,141],[47,138],[43,132],[39,128],[39,122],[41,121],[38,118],[35,120],[32,121],[30,122],[24,118],[22,110],[18,108],[13,109],[10,105],[9,100],[8,99],[10,99],[14,99],[16,95],[21,90],[22,88],[19,85],[15,80],[10,79],[8,77],[13,74],[19,70],[24,67],[25,60],[26,57],[25,52],[29,49],[30,44],[30,40],[34,36],[37,36],[40,42],[43,40],[45,38],[45,48],[48,52],[52,58],[50,66],[45,74],[48,80],[54,74],[58,68],[62,62],[65,52],[66,45]],
    // Arabian peninsula
    [[30,35],[28,35],[25,37],[21,39],[17,42],[13,44],[13,48],[16,53],[20,58],[24,60],[26,57],[28,50],[30,47],[31,44],[30,38],[30,35]],
    // India
    [[24,68],[22,70],[19,73],[15,74],[11,76],[8,77],[10,80],[13,80],[16,82],[19,85],[22,87],[23,89],[25,88],[26,84],[27,80],[29,78],[30,74],[28,71],[25,69],[24,68]],
    // Japan
    [[45,142],[43,145],[41,142],[38,141],[35,140],[34,136],[33,131],[35,133],[37,137],[39,140],[42,140],[45,142]],
    // Sumatra / Java / Borneo (Indonesia)
    [[6,95],[3,98],[-1,101],[-5,104],[-8,106],[-8,114],[-9,120],[-4,120],[-1,117],[1,111],[4,109],[6,116],[7,117],[5,108],[6,100],[6,95]],
    // Philippines
    [[19,121],[16,120],[12,120],[8,122],[6,125],[9,126],[13,124],[17,122],[19,121]],
    // New Guinea
    [[-1,131],[-2,137],[-4,141],[-8,144],[-10,148],[-9,150],[-6,147],[-4,140],[-2,134],[-1,131]],
    // Australia
    [[-11,132],[-12,137],[-14,141],[-17,146],[-20,149],[-25,153],[-30,153],[-34,151],[-38,147],[-38,141],[-35,138],[-33,135],[-32,133],[-32,126],[-34,123],[-35,118],[-34,115],[-31,115],[-26,114],[-22,114],[-20,119],[-16,123],[-14,127],[-12,130],[-11,132]],
    // Tasmania
    [[-40,145],[-41,148],[-43,147],[-43,145],[-42,144],[-40,145]],
    // New Zealand
    [[-35,173],[-37,175],[-39,177],[-41,175],[-41,172],[-44,171],[-46,167],[-45,169],[-42,173],[-39,174],[-37,173],[-35,173]]
  ];

  function pointInPoly(lat, lon, poly) {
    var inside = false, n = poly.length, j = n - 1;
    for (var i = 0; i < n; i++) {
      var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
      j = i;
    }
    return inside;
  }
  function isLand(lat, lon) {
    for (var i = 0; i < LAND.length; i++) if (pointInPoly(lat, lon, LAND[i])) return true;
    return false;
  }
  // Precompute land dots on a fine grid (density scaled by latitude), tagging
  // each as coastal (near an ocean cell) so coastlines can be drawn brighter.
  var landPts = [];
  var STEP = 1.65;
  for (var la = -56; la <= 80; la += STEP) {
    var stepLon = Math.max(STEP, STEP / Math.max(0.18, Math.cos(la * Math.PI / 180)));
    for (var lo = -180; lo < 180; lo += stepLon) {
      if (!isLand(la, lo)) continue;
      var coastal = !isLand(la + STEP, lo) || !isLand(la - STEP, lo) || !isLand(la, lo + stepLon) || !isLand(la, lo - stepLon);
      landPts.push([la, lo, coastal ? 1 : 0]);
    }
  }
  // Polar ice caps — Antarctica (a whole continent) and the Arctic sea-ice
  // sheet, rendered as pale blue-white so the Earth reads correctly top & bottom.
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

  var TILT = 20 * Math.PI / 180, cosT = Math.cos(TILT), sinT = Math.sin(TILT);
  function project(latDeg, lonDeg, rot) {
    var lat = latDeg * Math.PI / 180, lon = (lonDeg + rot) * Math.PI / 180;
    var x = Math.cos(lat) * Math.sin(lon);
    var y = Math.sin(lat);
    var z = Math.cos(lat) * Math.cos(lon);
    var y2 = y * cosT - z * sinT;
    var z2 = y * sinT + z * cosT;
    return { sx: cx + x * R, sy: cy - y2 * R, z: z2 };
  }

  var max = 1; data.forEach(function (c) { if (c.n > max) max = c.n; });
  var rot = 0, raf = null, t = 0, stopped = false;

  // ---- interaction: drag to spin, hover a marker for its country ----------
  var drag = null, spin = 0.16, hover = null, mouse = null;
  function localPt(e) {
    var r = canvas.getBoundingClientRect();
    var p = (e.touches && e.touches[0]) || e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function onDown(e) { drag = { x: localPt(e).x, rot: rot }; canvas.classList.add('is-drag'); }
  function onMove(e) {
    mouse = localPt(e);
    if (drag) { rot = drag.rot + (mouse.x - drag.x) * 0.55; e.preventDefault && e.preventDefault(); }
  }
  function onUp() { drag = null; canvas.classList.remove('is-drag'); }
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', function () { mouse = null; onUp(); });
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: true });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp);

  function drawGraticule() {
    // meridians + parallels as faint dotted arcs on the near hemisphere
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

  function draw() {
    if (stopped) return;
    // self-clean: stop drawing if the canvas has been removed (PJAX away)
    if (!document.body.contains(canvas)) { stopped = true; raf = null; return; }
    t++;
    if (!drag) rot += spin;             // hand on the globe stops the spin
    var hot = null;                     // marker under the pointer this frame
    ctx.clearRect(0, 0, W, H);

    // starfield
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      var tw = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.02 + st[3]));
      ctx.beginPath(); ctx.arc(st[0] * W, st[1] * H, st[2], 0, 6.2832);
      ctx.fillStyle = 'rgba(255,240,214,' + (tw * 0.5).toFixed(3) + ')'; ctx.fill();
    }

    // atmosphere glow
    var atm = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R * 1.22);
    atm.addColorStop(0, 'rgba(255,178,60,0)');
    atm.addColorStop(0.55, 'rgba(255,168,40,0.10)');
    atm.addColorStop(1, 'rgba(255,150,20,0)');
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 6.2832); ctx.fillStyle = atm; ctx.fill();

    // ocean sphere (glass)
    var grad = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.1, cx, cy, R);
    grad.addColorStop(0, 'rgba(70,120,175,0.30)');
    grad.addColorStop(0.55, 'rgba(38,74,120,0.20)');
    grad.addColorStop(1, 'rgba(6,20,40,0.30)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fillStyle = grad; ctx.fill();

    // terminator shading (day/night) — soft dark on the trailing edge
    var term = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
    term.addColorStop(0, 'rgba(0,0,0,0.28)');
    term.addColorStop(0.4, 'rgba(0,0,0,0.04)');
    term.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip();
    ctx.fillStyle = term; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    drawGraticule();

    // continents (dotted land); coastal cells render brighter + slightly larger
    for (var i = 0; i < landPts.length; i++) {
      var pt = landPts[i];
      var p = project(pt[0], pt[1], rot);
      if (p.z <= 0.02) continue;
      var coastal = pt[2];
      var a = (coastal ? 0.24 : 0.13) + p.z * (coastal ? 0.55 : 0.42);
      var rr = (coastal ? 1.0 : 0.8) + p.z * 0.8;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rr, 0, 6.2832);
      ctx.fillStyle = (coastal ? 'rgba(150,225,175,' : 'rgba(104,196,138,') + a.toFixed(3) + ')'; ctx.fill();
    }

    // polar ice caps — cool white, slightly glowing
    for (var k = 0; k < icePts.length; k++) {
      var ip = project(icePts[k][0], icePts[k][1], rot);
      if (ip.z <= 0.02) continue;
      var ia = 0.35 + ip.z * 0.55;
      ctx.beginPath(); ctx.arc(ip.sx, ip.sy, 1.1 + ip.z * 1.0, 0, 6.2832);
      ctx.fillStyle = 'rgba(232,244,255,' + ia.toFixed(3) + ')'; ctx.fill();
    }

    // city lights — warm points, brighter on the dusk (trailing) hemisphere
    for (var ci = 0; ci < CITIES.length; ci++) {
      var cp = project(CITIES[ci][0], CITIES[ci][1], rot);
      if (cp.z <= 0.04) continue;
      var dusk = 0.55 + 0.45 * (1 - cp.z);       // brighter near the terminator
      var tw = 0.6 + 0.4 * Math.sin(t * 0.05 + ci * 1.7);
      var ca = (0.20 + cp.z * 0.30) * dusk * tw;
      var cg = ctx.createRadialGradient(cp.sx, cp.sy, 0, cp.sx, cp.sy, 3.2);
      cg.addColorStop(0, 'rgba(255,226,150,' + Math.min(0.9, ca * 1.8).toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, 3.2, 0, 6.2832); ctx.fillStyle = cg; ctx.fill();
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, 0.7, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,240,205,' + Math.min(0.95, ca * 2.2).toFixed(3) + ')'; ctx.fill();
    }

    // specular sun glint on the lit (leading) shoulder of the globe
    var sunx = cx - R * 0.42, suny = cy - R * 0.46;
    var sg = ctx.createRadialGradient(sunx, suny, 0, sunx, suny, R * 0.5);
    sg.addColorStop(0, 'rgba(255,255,240,0.16)');
    sg.addColorStop(1, 'rgba(255,255,240,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip();
    ctx.beginPath(); ctx.arc(sunx, suny, R * 0.5, 0, 6.2832); ctx.fillStyle = sg; ctx.fill();
    ctx.restore();

    // limb darkening — the edge falls away, so the disc reads as a sphere
    var limb = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(2,6,16,0.45)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fillStyle = limb; ctx.fill();

    // rim light
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.strokeStyle = 'rgba(255,236,200,0.22)'; ctx.lineWidth = 1.1; ctx.stroke();

    // traffic markers + arcs to the busiest hub
    var hub = data.length ? COORDS[data[0].country] : null;
    var hubP = hub ? project(hub[0], hub[1], rot) : null;
    data.forEach(function (c, idx) {
      var co = COORDS[c.country]; if (!co) return;
      var p = project(co[0], co[1], rot);
      if (p.z <= 0) return;
      var rad = 2 + 5 * Math.sqrt(c.n / max);
      var pulse = 1 + 0.35 * Math.sin(t * 0.06 + c.country.charCodeAt(0));
      var alpha = 0.35 + p.z * 0.6;
      // connecting arc to hub
      if (hubP && idx > 0 && hubP.z > 0) {
        var mx = (p.sx + hubP.sx) / 2, my = (p.sy + hubP.sy) / 2;
        var lift = 26 + 10 * Math.sin(t * 0.03 + idx);
        ctx.beginPath();
        ctx.moveTo(hubP.sx, hubP.sy);
        ctx.quadraticCurveTo(mx, my - lift, p.sx, p.sy);
        ctx.strokeStyle = 'rgba(255,190,90,' + (0.12 * alpha).toFixed(3) + ')';
        ctx.lineWidth = 1; ctx.stroke();
      }
      // is the pointer on this marker?
      var isHot = mouse && Math.hypot(mouse.x - p.sx, mouse.y - p.sy) < Math.max(9, rad + 5);
      if (isHot) hot = { c: c, p: p, rad: rad };
      // expanding sonar ring — busiest first, staggered
      var ringT = (t * 0.012 + idx * 0.22) % 1;
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad + ringT * 22, 0, 6.2832);
      ctx.strokeStyle = 'rgba(255,190,90,' + ((1 - ringT) * 0.28 * alpha).toFixed(3) + ')';
      ctx.lineWidth = 1.2; ctx.stroke();
      // halo
      var hg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad * 3.4 * pulse);
      hg.addColorStop(0, 'rgba(255,162,0,' + ((isHot ? 0.5 : 0.30) * alpha).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(255,162,0,0)');
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad * 3.4 * pulse, 0, 6.2832); ctx.fillStyle = hg; ctx.fill();
      // core
      ctx.beginPath(); ctx.arc(p.sx, p.sy, isHot ? rad + 1.5 : rad, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,' + (isHot ? 225 : 196) + ',' + (isHot ? 140 : 70) + ',' + alpha.toFixed(3) + ')'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.sx, p.sy, isHot ? rad + 1.5 : rad, 0, 6.2832);
      ctx.strokeStyle = 'rgba(255,255,255,' + ((isHot ? 0.95 : 0.55) * alpha).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
    });

    // hovered marker gets a floating label with its country + visitor count
    if (hot) {
      var name = (COORDS[hot.c.country] && COORDS[hot.c.country][2]) || hot.c.country;
      var label = name + ' · ' + hot.c.n;
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      var tw = ctx.measureText(label).width, pad = 7;
      var bx = Math.min(Math.max(hot.p.sx - tw / 2 - pad, 4), W - tw - pad * 2 - 4);
      var by = hot.p.sy - hot.rad - 26;
      if (by < 4) by = hot.p.sy + hot.rad + 8;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw + pad * 2, 19, 6); else ctx.rect(bx, by, tw + pad * 2, 19);
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
  if (reduce) { rot = 24; stopped = true; draw2static(); }
  else start();

  function draw2static() { stopped = false; draw(); stopped = true; raf = null; }

  function onVis() {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (!reduce && !stopped) { if (!document.body.contains(canvas)) return; start(); }
  }
  document.addEventListener('visibilitychange', onVis);
  // register cleanup so PJAX navigation fully tears the loop down
  if (window.pjaxRegister) window.pjaxRegister(function () {
    stopped = true; if (raf) { cancelAnimationFrame(raf); raf = null; }
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('resize', resize);
  });

  // build the side list
  var list = document.getElementById('globeList');
  if (list) {
    if (!data.length) {
      list.innerHTML = '<li class="muted small">No location data yet. Country origin appears once traffic arrives through Cloudflare.</li>';
    } else {
      list.innerHTML = data.slice(0, 8).map(function (c) {
        var name = (COORDS[c.country] && COORDS[c.country][2]) || c.country;
        var pct = Math.round(c.n / max * 100);
        return '<li class="globe-row"><span class="globe-flag">' + flag(c.country) + '</span><span class="globe-name">' + name + '</span>'
          + '<span class="globe-bar"><span style="width:' + pct + '%"></span></span><span class="globe-n">' + c.n + '</span></li>';
      }).join('');
    }
  }
  function flag(cc) {
    return cc.replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); });
  }
})();
