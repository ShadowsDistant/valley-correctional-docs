(function () {
  'use strict';
  var canvas = document.getElementById('trafficGlobe');
  if (!canvas || !canvas.getContext) return;

  // Country centroids: ISO-3166 alpha-2 -> [lat, lon, name].
  var COORDS = {
    US: [39.8, -98.6, 'United States'], CA: [56.1, -106.3, 'Canada'], MX: [23.6, -102.5, 'Mexico'],
    BR: [-14.2, -51.9, 'Brazil'], AR: [-38.4, -63.6, 'Argentina'], CL: [-35.7, -71.5, 'Chile'], CO: [4.6, -74.3, 'Colombia'], PE: [-9.2, -75, 'Peru'],
    GB: [55.4, -3.4, 'United Kingdom'], IE: [53.4, -8, 'Ireland'], FR: [46.2, 2.2, 'France'], DE: [51.2, 10.4, 'Germany'], ES: [40.5, -3.7, 'Spain'], PT: [39.4, -8.2, 'Portugal'],
    IT: [41.9, 12.6, 'Italy'], NL: [52.1, 5.3, 'Netherlands'], BE: [50.5, 4.5, 'Belgium'], CH: [46.8, 8.2, 'Switzerland'], AT: [47.5, 14.6, 'Austria'],
    SE: [60.1, 18.6, 'Sweden'], NO: [60.5, 8.5, 'Norway'], FI: [61.9, 25.7, 'Finland'], DK: [56.3, 9.5, 'Denmark'], PL: [51.9, 19.1, 'Poland'],
    CZ: [49.8, 15.5, 'Czechia'], RO: [45.9, 24.9, 'Romania'], GR: [39.1, 21.8, 'Greece'], UA: [48.4, 31.2, 'Ukraine'], RU: [61.5, 105.3, 'Russia'], TR: [39, 35.2, 'Turkey'],
    IN: [20.6, 78.9, 'India'], CN: [35.9, 104.2, 'China'], JP: [36.2, 138.3, 'Japan'], KR: [35.9, 127.8, 'South Korea'], ID: [-0.8, 113.9, 'Indonesia'],
    PH: [12.9, 121.8, 'Philippines'], TH: [15.9, 100.9, 'Thailand'], VN: [14.1, 108.3, 'Vietnam'], MY: [4.2, 101.9, 'Malaysia'], SG: [1.35, 103.8, 'Singapore'],
    PK: [30.4, 69.3, 'Pakistan'], BD: [23.7, 90.4, 'Bangladesh'], AE: [23.4, 53.8, 'UAE'], SA: [23.9, 45.1, 'Saudi Arabia'], IL: [31, 34.9, 'Israel'],
    ZA: [-30.6, 22.9, 'South Africa'], NG: [9.1, 8.7, 'Nigeria'], EG: [26.8, 30.8, 'Egypt'], KE: [-0.02, 37.9, 'Kenya'], MA: [31.8, -7.1, 'Morocco'],
    AU: [-25.3, 133.8, 'Australia'], NZ: [-40.9, 174.9, 'New Zealand']
  };
  var data = (window.GLOBE_DATA || []).filter(function (c) { return COORDS[c.country]; });

  var ctx = canvas.getContext('2d');
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, R = 0, cx = 0, cy = 0;
  function resize() {
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    R = Math.min(W, H) / 2 - 8; cx = W / 2; cy = H / 2;
  }

  var css = getComputedStyle(document.documentElement);
  var accent = (css.getPropertyValue('--accent-strong') || '#ffa200').trim() || '#ffa200';
  var dotCol = 'rgba(255,236,200,';

  var TILT = 22 * Math.PI / 180, cosT = Math.cos(TILT), sinT = Math.sin(TILT);
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
  var rot = 0, raf = null, t = 0;
  function draw() {
    t++;
    rot += 0.18;
    ctx.clearRect(0, 0, W, H);

    // glass sphere
    var grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    grad.addColorStop(0, 'rgba(255,162,0,0.10)');
    grad.addColorStop(0.6, 'rgba(255,162,0,0.03)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,236,200,0.14)'; ctx.lineWidth = 1; ctx.stroke();

    // dotted landmass-ish sphere (a uniform lat/lon dot grid)
    for (var lat = -78; lat <= 78; lat += 6) {
      var lonStep = lat === 0 ? 6 : Math.max(6, 6 / Math.cos(lat * Math.PI / 180));
      for (var lon = -180; lon < 180; lon += lonStep) {
        var p = project(lat, lon, rot);
        if (p.z <= 0.02) continue;
        var a = 0.06 + p.z * 0.26;
        ctx.beginPath(); ctx.arc(p.sx, p.sy, 0.9 + p.z * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = dotCol + a.toFixed(3) + ')'; ctx.fill();
      }
    }

    // traffic markers
    data.forEach(function (c) {
      var co = COORDS[c.country]; if (!co) return;
      var p = project(co[0], co[1], rot);
      if (p.z <= 0) return;
      var rad = 2 + 5 * Math.sqrt(c.n / max);
      var pulse = 1 + 0.35 * Math.sin(t * 0.06 + c.country.charCodeAt(0));
      var alpha = 0.35 + p.z * 0.6;
      // halo
      var hg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad * 3.4 * pulse);
      hg.addColorStop(0, 'rgba(255,162,0,' + (0.28 * alpha).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(255,162,0,0)');
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad * 3.4 * pulse, 0, Math.PI * 2); ctx.fillStyle = hg; ctx.fill();
      // core
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,190,60,' + alpha.toFixed(3) + ')'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * alpha).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.stroke();
    });

    raf = requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { rot = 20; draw(); cancelAnimationFrame(raf); raf = null; }
  else draw();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (!raf && !reduce) draw();
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
