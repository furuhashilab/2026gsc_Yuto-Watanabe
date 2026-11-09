/*
 * shadow_direction_browser.js
 * 研究室のドローン画像（OpenAerialMap）とOSMの建物で、建物ごとの影の向きを推定する試行用スクリプト。
 * docs/shadow-direction-validation.md の結果はこのスクリプトで作った。
 *
 * 使い方（Google Chrome）
 *   1. https://titiler.hotosm.org/ を開く（画像タイルを同じサイトから読むため。別のページでは読めない）
 *   2. 開発者ツール（F12）の Console に、このファイルの中身をすべて貼り付けて Enter
 *   3. Console で  await ShadowDir.run()  を実行（2〜3分。進み具合が表示される）
 *   4. 結果の表が欲しいときは  ShadowDir.downloadCSV()  でCSVを保存
 *
 * データ
 *   画像：OpenAerialMap「sagamihara20211215aoyamauniv1155mapconcierge00arw01」
 *         提供 CrisisMappersJapan/DRONEBIRD/FuruhashiLab/YouthMappersAGU、CC BY 4.0
 *   建物：© OpenStreetMap contributors、ODbL（OSM APIから実行時に取得）
 *
 * License: MIT
 */
(() => {
  const CFG = {
    bbox: { w: 139.397592, s: 35.562283, e: 139.40876, n: 35.571917 }, // ドローン画像の範囲
    cog: 'https://oin-hotosm-temp.s3.us-east-1.amazonaws.com/61b9d9d7b26de1000596d622/0/61b9d9d7b26de1000596d623.tif',
    zoom: 19,            // 約0.24m/画素
    lumShadow: 35,       // これ以下の明るさは「影」
    lumLit: 60,          // これ以上の明るさは「日なた」（間は直線でつなぐ）
    maxShadowM: 60,      // 調べる影の長さの上限（m）
    minShadowM: 3,       // 調べる影の長さの下限（m）
    stepDeg: 3,          // 全方位を調べる刻み（度）
    localSigmaM: 60,     // 周りの建物を束ねるときの距離（m）
    interiorM: 50,       // 画像の縁からこれ以上内側を「内側エリア」とする（m）
    expected: [355, 17], // 撮影時刻（11:30〜12:30）から見た妥当な範囲（度、±3°の余裕込み）
  };
  const log = (...a) => console.log('[ShadowDir]', ...a);
  const S = {}; // 途中結果

  // ---------- 座標 ----------
  const Z = CFG.zoom;
  const lon2x = lon => (lon + 180) / 360 * 2 ** Z;
  const lat2y = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z; };

  // ---------- 1. OSMの建物 ----------
  async function loadBuildings() {
    const b = CFG.bbox;
    const txt = await (await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${b.w},${b.s},${b.e},${b.n}`)).text();
    const doc = new DOMParser().parseFromString(txt, 'application/xml');
    const nodes = new Map();
    for (const n of doc.getElementsByTagName('node')) nodes.set(n.getAttribute('id'), [+n.getAttribute('lat'), +n.getAttribute('lon')]);
    const tagsOf = el => { const t = {}; for (const c of el.children) if (c.tagName === 'tag') t[c.getAttribute('k')] = c.getAttribute('v'); return t; };
    const ways = new Map();
    for (const w of doc.getElementsByTagName('way')) {
      const nd = []; for (const c of w.children) if (c.tagName === 'nd') nd.push(c.getAttribute('ref'));
      ways.set(w.getAttribute('id'), { nd, tags: tagsOf(w) });
    }
    const ring = nd => { const r = []; for (const id of nd) { const p = nodes.get(id); if (!p) return null; r.push(p); } return r; };
    const bld = [];
    for (const [id, w] of ways) {
      if (!w.tags.building || w.nd.length < 4 || w.nd[0] !== w.nd[w.nd.length - 1]) continue;
      const r = ring(w.nd); if (r) bld.push({ id: 'w' + id, tags: w.tags, rings: [r] });
    }
    for (const rel of doc.getElementsByTagName('relation')) {
      const t = tagsOf(rel); if (!t.building) continue;
      const outers = [], inners = [];
      for (const c of rel.children) {
        if (c.tagName !== 'member' || c.getAttribute('type') !== 'way') continue;
        const w = ways.get(c.getAttribute('ref')); if (!w || w.nd[0] !== w.nd[w.nd.length - 1]) continue;
        const r = ring(w.nd); if (!r) continue;
        (c.getAttribute('role') === 'inner' ? inners : outers).push(r);
      }
      if (outers.length) bld.push({ id: 'r' + rel.getAttribute('id'), tags: t, rings: [...outers, ...inners] });
    }
    return bld;
  }

  // ---------- 2. ドローン画像のタイル ----------
  async function loadMosaic() {
    const b = CFG.bbox;
    const tx0 = Math.floor(lon2x(b.w)), tx1 = Math.floor(lon2x(b.e)), ty0 = Math.floor(lat2y(b.n)), ty1 = Math.floor(lat2y(b.s));
    const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
    const mpp = 40075016.686 * Math.cos(35.567 * Math.PI / 180) / 2 ** (Z + 8);
    const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d', { willReadFrequently: true });
    const jobs = []; for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) jobs.push([x, y]);
    let i = 0, ok = 0;
    async function worker() {
      while (i < jobs.length) {
        const [x, y] = jobs[i++];
        try {
          const r = await fetch(`/cog/tiles/WebMercatorQuad/${Z}/${x}/${y}@1x?url=${encodeURIComponent(CFG.cog)}`);
          if (!r.ok) continue;
          ctx.drawImage(await createImageBitmap(await r.blob()), (x - tx0) * 256, (y - ty0) * 256); ok++;
        } catch (e) { /* 画像のないタイル */ }
      }
    }
    await Promise.all(Array.from({ length: 12 }, worker));
    log(`タイル ${ok}/${jobs.length} 枚`);
    const d = ctx.getImageData(0, 0, W, H).data;
    const lum = new Uint8Array(W * H), valid = new Uint8Array(W * H);
    for (let p = 0, q = 0; p < W * H; p++, q += 4) {
      valid[p] = d[q + 3] > 0 && (d[q] + d[q + 1] + d[q + 2]) > 0 ? 1 : 0;
      lum[p] = (0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]) | 0;
    }
    return { W, H, mpp, tx0, ty0, lum, valid };
  }

  // ---------- 3. 建物の塗りつぶし・画像の縁からの距離 ----------
  function fillPoly(rings, val, target, W, H) {
    let ymin = Infinity, ymax = -Infinity;
    for (const r of rings) for (const p of r) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
    const y0 = Math.max(0, Math.ceil(ymin - 0.5)), y1 = Math.min(H - 1, Math.floor(ymax - 0.5));
    let cnt = 0;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (const r of rings) for (let k = 0; k < r.length - 1; k++) {
        const a = r[k], b = r[k + 1];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) { target[y * W + x] = val; cnt++; }
      }
    }
    return cnt;
  }

  function edgeDistance(M) { // 画像のない所（と画像の外）からの距離（m）。4画素ごとの粗い計算
    const { W, H, mpp, valid } = M, B = 4, w = Math.ceil(W / B), h = Math.ceil(H / B), D = new Float32Array(w * h), d2 = Math.SQRT2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let inv = 0;
      for (let yy = y * B; yy < Math.min(H, y * B + B); yy++) for (let xx = x * B; xx < Math.min(W, x * B + B); xx++) if (!valid[yy * W + xx]) inv++;
      D[y * w + x] = inv > B * B / 2 ? 0 : 1e9;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; let v = D[p];
      if (x == 0 || y == 0 || x == w - 1 || y == h - 1) v = Math.min(v, 1);
      if (x > 0) v = Math.min(v, D[p - 1] + 1); if (y > 0) v = Math.min(v, D[p - w] + 1);
      if (x > 0 && y > 0) v = Math.min(v, D[p - w - 1] + d2); if (x < w - 1 && y > 0) v = Math.min(v, D[p - w + 1] + d2);
      D[p] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x; let v = D[p];
      if (x < w - 1) v = Math.min(v, D[p + 1] + 1); if (y < h - 1) v = Math.min(v, D[p + w] + 1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, D[p + w + 1] + d2); if (x > 0 && y < h - 1) v = Math.min(v, D[p + w - 1] + d2);
      D[p] = v;
    }
    return (x, y) => D[Math.floor(y / B) * w + Math.floor(x / B)] * B * mpp;
  }

  // ---------- 4. 建物ごとの影の向き ----------
  // 建物の外形から方向θへ帯を伸ばし、帯の中が暗いほど、帯の左右と先が明るいほど点が高くなる。
  // 他の建物に当たった所は少し減点する。全方位をstepDeg刻みで調べ、最も点の高い向きを選ぶ。
  function makeAnalyzer(M, bld, lab) {
    const { W, H, mpp, lum, valid } = M;
    const PEN_OCC = -0.5, NF = 4, TIPW = 4;
    const LMAX = Math.round(CFG.maxShadowM / mpp), LMIN = Math.round(CFG.minShadowM / mpp);
    const C = new Float32Array(256);
    for (let l = 0; l < 256; l++) { const s = Math.min(1, Math.max(0, (CFG.lumLit - l) / (CFG.lumLit - CFG.lumShadow))); C[l] = 2 * s - 1; }
    const cval = (x, y, v) => {
      const X = Math.floor(x), Y = Math.floor(y); if (X < 0 || Y < 0 || X >= W || Y >= H) return null;
      const p = Y * W + X, lv = lab[p]; if (lv) return lv === v ? 'self' : 'bld'; if (!valid[p]) return 'noimg'; return C[lum[p]];
    };
    function prep(i) {
      const b = bld[i], v = i + 1;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const r of b.px) for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      x0 = Math.max(1, Math.floor(x0)); y0 = Math.max(1, Math.floor(y0)); x1 = Math.min(W - 2, Math.ceil(x1)); y1 = Math.min(H - 2, Math.ceil(y1));
      const bd = []; let n = 0, nv = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const p = y * W + x; if (lab[p] !== v) continue; n++; if (valid[p]) nv++;
        if (lab[p - 1] !== v || lab[p + 1] !== v || lab[p - W] !== v || lab[p + W] !== v) bd.push(x, y);
      }
      return { bd, n, nv, v };
    }
    function sweep(P, theta) {
      const { bd, v } = P, t = theta * Math.PI / 180, ux = Math.sin(t), uy = -Math.cos(t), nx = -uy, ny = ux;
      const col = new Map(); // θに直角な列ごとに、いちばん先の外形の画素だけを使う
      for (let j = 0; j < bd.length; j += 2) {
        const x = bd[j] + 0.5, y = bd[j + 1] + 0.5, a = x * ux + y * uy, s = Math.round(x * nx + y * ny), o = col.get(s);
        if (!o || a > o[0]) col.set(s, [a, j]);
      }
      const keys = [...col.keys()].sort((a, b) => a - b);
      const A = new Float64Array(LMAX + TIPW + 2), Eo = new Float64Array(LMAX + TIPW + 2), Fl = new Float64Array(LMAX + 2);
      let nray = 0, first = null, last = null;
      for (const s of keys) {
        const j = col.get(s)[1], bx = bd[j] + 0.5, by = bd[j + 1] + 0.5; let k0 = -1;
        for (let k = 1; k <= 3; k++) { const r = cval(bx + k * ux, by + k * uy, v); if (r === null) break; if (r !== 'self') { k0 = k; break; } }
        if (k0 < 0) continue; nray++;
        const sx = bx + k0 * ux, sy = by + k0 * uy; if (!first) first = [sx, sy]; last = [sx, sy];
        for (let d = 0; d < LMAX + TIPW; d++) { const r = cval(sx + d * ux, sy + d * uy, v); if (typeof r !== 'number') { Eo[d]++; break; } A[d] += r; }
      }
      if (nray < 3) return { J: -1e9, L: 0, nray };
      for (const [pt, sg] of [[first, -1], [last, 1]]) for (let o = 1; o <= NF; o++) { // 帯の左右
        const fx = pt[0] + sg * o * nx, fy = pt[1] + sg * o * ny;
        for (let d = 0; d < LMAX; d++) { const r = cval(fx + d * ux, fy + d * uy, v); if (typeof r !== 'number') break; Fl[d] += r; }
      }
      const pre = new Float64Array(LMAX + TIPW + 2); { let s = 0; for (let d = 0; d < LMAX + TIPW; d++) { s += A[d]; pre[d + 1] = s; } }
      let cumA = 0, cumO = 0, cumF = 0, best = -1e9, Lb = 0;
      for (let d = 0; d < LMAX; d++) {
        cumO += Eo[d]; cumA += A[d] + PEN_OCC * cumO; cumF += Fl[d];
        if (d + 1 < LMIN) continue;
        const tip = pre[Math.min(LMAX + TIPW, d + 1 + TIPW)] - pre[d + 1];
        const J = cumA - cumF - tip;
        if (J > best) { best = J; Lb = d + 1; }
      }
      return { J: best, L: Lb, nray };
    }
    return function analyze(i) {
      const b = bld[i], P = prep(i), N = Math.round(360 / CFG.stepDeg);
      const r = { i, status: 'ok' };
      if (P.n < 40) { r.status = 'tiny'; return r; }
      if (P.nv / P.n < 0.8) { r.status = 'no_image'; return r; }
      const R = Math.round(30 / mpp); let nv = 0, nt = 0; // 30m四方に画像のない所がどれだけあるか
      for (let y = Math.floor(b.cy - R); y <= b.cy + R; y += 6) for (let x = Math.floor(b.cx - R); x <= b.cx + R; x += 6) { nt++; if (x >= 0 && y >= 0 && x < W && y < H && valid[y * W + x]) nv++; }
      r.edge = +(1 - nv / nt).toFixed(3);
      const Jc = new Float64Array(N); let bi = 0;
      for (let a = 0; a < N; a++) { Jc[a] = sweep(P, a * CFG.stepDeg).J; if (Jc[a] > Jc[bi]) bi = a; }
      let bs = null;
      for (let dt = -CFG.stepDeg; dt <= CFG.stepDeg; dt++) { const th = (bi * CFG.stepDeg + dt + 360) % 360, s = sweep(P, th); if (!bs || s.J > bs.J) { bs = s; bs.t = th; } }
      r.dir = bs.t; r.Lm = bs.L * mpp; r.Jc = Jc;
      if (bs.J <= 0) r.status = 'noshadow';
      return r;
    };
  }

  // ---------- 5. 周りの建物を束ねた向き ----------
  function makeLocal(bld, res, mpp) {
    const N = Math.round(360 / CFG.stepDeg);
    const src = res.filter(r => r.status === 'ok' && r.edge <= 0.02 && Math.max(...r.Jc) > 0).map(r => {
      const m = Math.max(...r.Jc); return { x: bld[r.i].cx, y: bld[r.i].cy, v: Array.from(r.Jc, a => Math.max(0, a) / m) };
    });
    const sig = CFG.localSigmaM / mpp, s2 = 2 * sig * sig, cut = (3 * sig) ** 2;
    return (x, y) => {
      const Sv = new Float64Array(N); let wsum = 0;
      for (const q of src) { const d2 = (q.x - x) ** 2 + (q.y - y) ** 2; if (d2 > cut) continue; const w = Math.exp(-d2 / s2); wsum += w; for (let a = 0; a < N; a++) Sv[a] += w * q.v[a]; }
      if (wsum < 3) return null;
      let mi = 0; for (let a = 1; a < N; a++) if (Sv[a] > Sv[mi]) mi = a;
      const mx = Sv[mi]; let cx = 0, cy = 0;
      for (let k = -15; k <= 15; k++) { const a = (mi + k + N) % N; if (Sv[a] < 0.95 * mx) continue; const w = Sv[a] - 0.9 * mx, t = a * CFG.stepDeg * Math.PI / 180; cx += w * Math.cos(t); cy += w * Math.sin(t); }
      return ((Math.atan2(cy, cx) * 180 / Math.PI) + 360) % 360;
    };
  }

  const inExpected = d => { const [a, b] = CFG.expected; return a > b ? (d >= a || d <= b) : (d >= a && d <= b); };
  function wallOrient(b) { // 建物の壁の主な向き（90°周期）
    const r = b.px[0]; let sx = 0, sy = 0;
    for (let k = 0; k < r.length - 1; k++) { const dx = r[k + 1][0] - r[k][0], dy = r[k + 1][1] - r[k][1], L = Math.hypot(dx, dy), a = Math.atan2(dx, -dy) * 4; sx += L * Math.cos(a); sy += L * Math.sin(a); }
    return ((Math.atan2(sy, sx) / 4 * 180 / Math.PI) + 90) % 90;
  }

  // ---------- 実行 ----------
  async function run() {
    const t0 = performance.now();
    log('OSMの建物を取得中…'); const bld = await loadBuildings(); log(`建物 ${bld.length} 棟`);
    log('ドローン画像を取得中…'); const M = await loadMosaic();
    const { W, H, mpp, tx0, ty0 } = M;
    const lab = new Int32Array(W * H);
    bld.forEach((b, i) => {
      b.px = b.rings.map(r => r.map(([la, lo]) => [(lon2x(lo) - tx0) * 256, (lat2y(la) - ty0) * 256]));
      let sx = 0, sy = 0; for (const p of b.px[0]) { sx += p[0]; sy += p[1]; } b.cx = sx / b.px[0].length; b.cy = sy / b.px[0].length;
      b.area = fillPoly(b.px, i + 1, lab, W, H) * mpp * mpp;
    });
    const dist = edgeDistance(M);
    const analyze = makeAnalyzer(M, bld, lab), res = [];
    for (let i = 0; i < bld.length; i++) { res.push(analyze(i)); if (i % 200 === 0) { log(`影の向き ${i}/${bld.length}`); await new Promise(r => setTimeout(r, 0)); } }
    const local = makeLocal(bld, res, mpp);
    const rows = bld.map((b, i) => {
      const r = res[i], X = b.cx / 256 + tx0, Y = b.cy / 256 + ty0, n = Math.PI - 2 * Math.PI * Y / 2 ** Z;
      const dEdge = dist(b.cx, b.cy);
      const zone = r.status === 'no_image' ? 'no_image' : (dEdge >= CFG.interiorM ? 'interior' : 'margin');
      const own = r.status === 'ok' ? r.dir : null;
      const loc = (r.status === 'no_image' || r.status === 'tiny') ? null : local(b.cx, b.cy);
      let wall = null; if (own != null) { let rel = ((own - wallOrient(b)) % 90 + 90) % 90; if (rel > 45) rel -= 90; wall = Math.abs(rel) <= 6; }
      return {
        osm_id: b.id, lat: +(180 / Math.PI * Math.atan(Math.sinh(n))).toFixed(6), lon: +(X / 2 ** Z * 360 - 180).toFixed(6),
        area_m2: +b.area.toFixed(1), building: b.tags.building, levels: b.tags['building:levels'] || '',
        zone, edge_dist_m: +dEdge.toFixed(1), status: r.status,
        own_dir: own, own_in: own == null ? null : inExpected(own), wall_aligned: wall,
        local_dir: loc == null ? null : +loc.toFixed(1), local_in: loc == null ? null : inExpected(loc),
      };
    });
    S.rows = rows;
    const I = rows.filter(r => r.zone === 'interior'), Mg = rows.filter(r => r.zone === 'margin');
    const own = I.filter(r => r.own_dir != null), ownOut = own.filter(r => !r.own_in), loc = I.filter(r => r.local_dir != null), ownM = Mg.filter(r => r.own_dir != null);
    S.stats = {
      buildings: rows.length, no_image: rows.filter(r => r.zone === 'no_image').length, interior: I.length, margin: Mg.length,
      interior_own: `${own.filter(r => r.own_in).length}/${own.length}`,
      interior_local: `${loc.filter(r => r.local_in).length}/${loc.length}`,
      interior_wrong_wall_aligned: `${ownOut.filter(r => r.wall_aligned).length}/${ownOut.length}`,
      margin_own: `${ownM.filter(r => r.own_in).length}/${ownM.length}`,
      minutes: +((performance.now() - t0) / 60000).toFixed(1),
    };
    log('完了', S.stats);
    return S.stats;
  }

  function downloadCSV(name = 'shadow_direction_buildings.csv') {
    if (!S.rows) throw new Error('先に await ShadowDir.run() を実行してください');
    const cols = Object.keys(S.rows[0]);
    const esc = v => v == null ? '' : (typeof v === 'boolean' ? (v ? 1 : 0) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const csv = '﻿' + [cols.join(','), ...S.rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
  }

  window.ShadowDir = { run, downloadCSV, state: S, config: CFG };
  log('準備完了：await ShadowDir.run() を実行してください');
})();
