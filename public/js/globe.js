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
    // North America (mainland + Canada)
    [[71,-156],[70,-128],[60,-140],[55,-131],[48,-124],[40,-124],[34,-120],[31,-115],[23,-110],[22,-105],[19,-104],[16,-96],[18,-94],[21,-90],[18,-88],[21,-87],[26,-80],[30,-82],[35,-76],[40,-74],[44,-67],[47,-60],[52,-56],[55,-60],[60,-65],[63,-78],[58,-94],[64,-88],[69,-84],[73,-95],[73,-120],[72,-140],[71,-156]],
    // Greenland
    [[83,-30],[81,-18],[76,-20],[70,-22],[60,-44],[64,-51],[70,-54],[76,-58],[80,-45],[83,-30]],
    // Central America
    [[18,-94],[16,-92],[13,-88],[9,-83],[8,-78],[10,-84],[14,-88],[16,-92],[18,-94]],
    // South America
    [[11,-72],[10,-64],[7,-59],[4,-52],[0,-50],[-5,-35],[-9,-35],[-15,-39],[-23,-41],[-30,-50],[-35,-53],[-40,-62],[-46,-67],[-52,-69],[-55,-68],[-52,-73],[-42,-73],[-33,-71],[-24,-70],[-18,-70],[-14,-76],[-5,-81],[0,-80],[6,-77],[11,-72]],
    // Africa
    [[35,-6],[33,10],[31,20],[32,28],[27,34],[20,37],[12,43],[10,51],[2,46],[-5,40],[-11,40],[-17,37],[-25,33],[-34,26],[-34,19],[-29,16],[-22,14],[-15,12],[-8,13],[-1,9],[4,7],[4,-4],[6,-8],[10,-15],[15,-17],[21,-17],[28,-13],[33,-9],[35,-6]],
    // Madagascar
    [[-12,49],[-16,50],[-22,48],[-25,45],[-22,43],[-16,44],[-12,49]],
    // Europe
    [[71,26],[70,30],[64,40],[60,30],[57,24],[54,20],[54,14],[54,10],[57,8],[58,5],[62,5],[64,12],[68,15],[71,26]],
    [[60,-9],[58,-5],[52,-6],[50,-2],[47,-2],[43,-9],[40,-9],[37,-9],[36,-6],[37,0],[41,3],[43,4],[44,9],[40,18],[38,16],[40,20],[45,13],[45,29],[47,38],[50,40],[55,50],[60,55],[66,60],[68,50],[66,42],[62,30],[60,22],[57,14],[54,10],[52,4],[51,-4],[54,-8],[58,-8],[60,-9]],
    // Great Britain + Ireland
    [[58,-5],[57,-2],[53,0],[51,1],[50,-5],[53,-5],[55,-6],[58,-5]],
    [[55,-8],[54,-6],[52,-6],[51,-10],[53,-10],[55,-8]],
    // Asia (broad)
    [[66,42],[70,60],[73,80],[76,100],[73,113],[70,130],[73,142],[66,170],[60,170],[62,155],[59,150],[54,140],[52,142],[46,135],[43,132],[40,128],[39,122],[41,121],[38,118],[35,120],[31,122],[24,118],[22,110],[18,108],[10,105],[8,100],[13,100],[10,98],[16,94],[22,92],[21,88],[15,80],[8,78],[13,74],[20,70],[24,66],[25,58],[27,56],[26,50],[30,48],[30,40],[37,36],[41,40],[45,38],[47,48],[50,52],[52,60],[48,68],[45,76],[50,80],[54,72],[58,66],[62,58],[66,50],[66,42]],
    // Arabian peninsula
    [[30,35],[28,34],[24,38],[20,40],[15,43],[13,45],[17,52],[22,60],[26,57],[29,48],[30,44],[30,35]],
    // India / SE Asia already partly covered; India tip
    [[24,68],[22,70],[16,73],[10,77],[8,78],[13,80],[18,84],[22,88],[25,88],[26,80],[28,74],[24,68]],
    // Japan
    [[45,142],[43,145],[40,141],[36,140],[34,135],[33,131],[35,133],[38,138],[41,140],[45,142]],
    // Indonesia / Philippines cluster (rough islands)
    [[6,95],[3,98],[-2,102],[-6,105],[-8,114],[-8,120],[-3,120],[0,112],[3,108],[5,100],[6,95]],
    [[19,121],[16,120],[10,123],[6,125],[9,126],[14,124],[18,122],[19,121]],
    // Australia
    [[-11,132],[-12,137],[-15,141],[-18,146],[-25,153],[-32,153],[-38,147],[-38,141],[-35,138],[-32,133],[-33,123],[-35,118],[-31,115],[-22,114],[-18,122],[-14,126],[-11,130],[-11,132]],
    // New Zealand
    [[-35,173],[-38,176],[-41,175],[-41,171],[-45,169],[-46,167],[-44,170],[-41,173],[-38,174],[-35,173]]
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
  var STEP = 1.9;
  for (var la = -56; la <= 80; la += STEP) {
    var stepLon = Math.max(STEP, STEP / Math.max(0.18, Math.cos(la * Math.PI / 180)));
    for (var lo = -180; lo < 180; lo += stepLon) {
      if (!isLand(la, lo)) continue;
      var coastal = !isLand(la + STEP, lo) || !isLand(la - STEP, lo) || !isLand(la, lo + stepLon) || !isLand(la, lo - stepLon);
      landPts.push([la, lo, coastal ? 1 : 0]);
    }
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
    rot += 0.16;
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
      // halo
      var hg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad * 3.4 * pulse);
      hg.addColorStop(0, 'rgba(255,162,0,' + (0.30 * alpha).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(255,162,0,0)');
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad * 3.4 * pulse, 0, 6.2832); ctx.fillStyle = hg; ctx.fill();
      // core
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,196,70,' + alpha.toFixed(3) + ')'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad, 0, 6.2832);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * alpha).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
    });

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
