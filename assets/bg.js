// The hero scene: a live frame-time graph written at a head and scrolling left, like an in-game overlay, on a
// perspective floor with bloom. A 13 s loop: SCSKiller "off" (stutter spikes erupt at the head: sparks, a shock ring,
// a small shake), then "on": a flash at the head and a wave that runs left across the graph, flattening every spike it
// passes into sparks, then a smooth cyan line. Then off again.
// The same frames drive the overlay card ([data-overlay]): FPS, frame time, lows and hitches of the current phase.
// WebGL2 (scene -> bloom chain -> composite, plus instanced spark quads), Canvas 2D fallback (?r=2d forces it).
// It always animates (no reduced-motion gating). It pauses when the tab is hidden or the canvas is off screen.
(() => {
  const canvas = document.querySelector('canvas.scene');
  if (!canvas) return;

  const MAX_PIXELS = 2.1e6, DPR_CAP = 1.5;
  const band = canvas.dataset.variant === 'band';
  const Y0 = band ? 0.2 : 0.17, AMP = band ? 0.55 : 0.5;   // baseline and 100 ms height, fractions of canvas height
  const L = 13, SW0 = 6, SWD = 1.5, OFF0 = 12.3, OFF1 = 12.9, HITCH = 0.2;   // loop, fix wave start/length, 20 ms
  const T_START = +(new URLSearchParams(location.search).get('t') || (band ? 9 : 3.2));   // ?t= pins the start (screenshots)
  // [frame width css px, frames/s, seed, amp, alpha, glow css px, reach, parallax]
  const MAIN = [6, 20, 1, 1.0, 1.0, 7, 3, 0], GHOST = [9, 13, 7, 0.72, 0.32, 14, 2, 14], FAR = [14, 8, 13, 0.5, 0.16, 22, 1, 30];
  const SPEED = MAIN[0] * MAIN[1];   // css px/s the main trace scrolls

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  // ---- shared frame model (mirrored in the GLSL) ----
  const ss = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const hash = (x) => {
    x >>>= 0;
    x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 4294967295;
  };
  const spike = (i, seed) => {
    const k = (i * 3 + seed) >>> 0, r = hash(k + 1), h = hash(k + 2);
    return r > 0.93 ? 0.18 + 0.8 * h * h : r > 0.84 ? 0.06 + 0.1 * h : 0;
  };
  const baseV = (i, seed) => 0.075 + 0.03 * hash((i * 3 + seed) >>> 0);
  // "On" is [SW0, OFF0): every frame born then is calm. After OFF0 the spikes grow back over OFF0..OFF1.
  const isOn = (ph) => ph >= SW0 && ph < OFF0;
  const birthCalm = (ph) => ph < SW0 ? 0 : ph < OFF0 ? 1 : 1 - ss(OFF0, OFF1, ph);
  // Calm of a frame born at b (s), now drawn at x (css px). Frames born while "off" stay spiky until the next fix
  // wave (running left from the head) passes them.
  const calmOf = (b, x) => {
    const n = Math.floor(b / L), ph = b - n * L;
    if (isOn(ph)) return 1;
    const c0 = birthCalm(ph), tt = t - ((ph < SW0 ? n : n + 1) * L + SW0);
    if (tt <= 0) return c0;
    if (tt >= SWD) return 1;
    return c0 + (1 - c0) * ss(0, 40, x - frontX(tt));
  };
  // a frame's value when it left the head (no wave yet): what the overlay measures
  const headVal = (i, seed, fps) => {
    const b = (i - 4096) / fps;
    return baseV(i, seed) + spike(i, seed) * (1 - birthCalm(b - L * Math.floor(b / L)));
  };
  const frontX = (tt) => headX - (headX + 80) * ss(0, SWD, tt);
  const frameX = (i, fw, fps) => headX - (t * fps + 4096 - i) * fw;
  const frameV = (i, seed, fps, fw) => baseV(i, seed) + spike(i, seed) * (1 - calmOf((i - 4096) / fps, frameX(i, fw, fps)));
  const heat = (v) => {
    const a = ss(0.14, 0.3, v), b = ss(0.4, 0.75, v), mix = (x, y, k) => x + (y - x) * k;
    return [mix(mix(0.30, 1, a), 1, b), mix(mix(0.76, 0.71, a), 0.33, b), mix(mix(1, 0.33, a), 0.28, b)];
  };
  const CYAN = [0.30, 0.76, 1.0], WARM = [1.0, 0.42, 0.25];

  // ---- state ----
  let t = T_START, cw = 1, ch = 1, scale = 1, headX = 0, headV = 0, lastI = -1, count = 0, wasOn = null, lastPh = 0;
  let flash = 0, pulse = 0, glitch = 0, shakeX = 0, shakeY = 0, warmth = 1, hudT = 0;
  let running = false, visible = !document.hidden, onScreen = true, raf = 0, last = 0;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, seen: false };
  const rings = [];   // {x, y, age, s} s > 0 warm, s < 0 cyan
  const parts = [];   // sparks and embers
  const motes = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: 0.25 + Math.random() * 0.75, p: Math.random() * 6.28 }));
  const MAX_PARTS = 900;
  const stats = { fps: 0, renderer: '' };
  const WIN = 200, FPS_WIN = 10, GRAPH_N = 90;   // WIN caps the phase window (a phase is ~130 frames)
  const win = [];   // head frames of the current phase
  let iStart = 0;
  const hud = document.querySelector('[data-overlay]');
  const q = (k) => hud && hud.querySelector(`[data-o="${k}"]`);
  const O = { fps: q('fps'), ms: q('ms'), low: q('low'), low01: q('low01'), hitch: q('hitch'), state: q('state'), cache: q('cache') };
  const hudCanvas = hud && hud.querySelector('canvas'), hg = hudCanvas && hudCanvas.getContext('2d');
  window.__bg = stats;

  const rnd = (a, b) => a + Math.random() * (b - a);
  function burst(x, y, n, col, speed, up, life) {
    for (let k = 0; k < n && parts.length < MAX_PARTS; k++) {
      const a = up ? rnd(0.15, Math.PI - 0.15) : rnd(0, Math.PI * 2), s = speed * rnd(0.25, 1);
      const c = col.length === 2 ? (Math.random() < 0.5 ? col[0] : col[1]) : col;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + (up ? speed * 0.2 : 0), life: 0, max: life * rnd(0.5, 1.2),
        size: rnd(0.9, 2.2), c, g: rnd(500, 900), drag: rnd(1.2, 2.4) });
    }
  }
  function ring(x, y, s) { rings.push({ x, y, age: 0, s }); if (rings.length > 4) rings.shift(); }

  function step(dt) {
    t += dt;
    const H = canvas.clientHeight || 1, y0 = H * Y0, A = H * AMP;
    const [fw, fps, seed] = MAIN;
    const ph = t - L * Math.floor(t / L);
    const u = t * fps + 4096, i0 = Math.floor(u), f = u - i0;
    headV = frameV(i0, seed, fps, fw) * (1 - f) + frameV(i0 + 1, seed, fps, fw) * f;

    const on = isOn(ph);
    if (on !== wasOn) {   // a switch starts a new phase: the overlay's window and hitch count start over
      const first = wasOn === null;
      wasOn = on; count = 0; win.length = 0;
      const n = Math.floor(t / L), t0 = on ? n * L + SW0 : ph >= OFF0 ? n * L + OFF0 : (n - 1) * L + OFF0;
      iStart = Math.ceil(t0 * fps + 4096);   // the first frame born in this phase
      if (on && !first) {
        pulse = 1; ring(headX, y0 + headV * A, -1.6);
        burst(headX, y0 + headV * A, 160, [CYAN, [0.8, 0.95, 1]], 900, false, 1.3);
        emit('scene:fix');
      }
      setHudState(on);
    }
    if (i0 !== lastI) {   // the head passed one or more vertices: record them; a frame of 20 ms or more is a hitch
      const live = lastI >= 0 && dt > 0;   // not the backfill on the first step
      for (let i = Math.max(lastI + 1, iStart, i0 - WIN + 1); i <= i0; i++) {
        const v = headVal(i, seed, fps);
        win.push(v); if (win.length > WIN) win.shift();
        if (v < HITCH) continue;
        count++;
        if (!live) continue;
        flash = Math.min(1, Math.max(flash, 0.35 + v));
        const hy = y0 + v * A;
        ring(headX, hy, 0.5 + v);
        burst(headX, hy, Math.round(10 + v * 55), [heat(v), [1, 0.85, 0.6]], 380 + v * 520, true, 1.1);
        if (v > 0.35) glitch = Math.max(glitch, v);
        emit('scene:hitch', { v });
      }
      lastI = i0;
    }

    // the fix wave: every spike it passes breaks into sparks
    const tt = ph - SW0, ttPrev = lastPh - SW0;
    if (dt > 0 && tt > 0 && ttPrev < SWD && ph > lastPh) {
      const xPrev = ttPrev <= 0 ? headX + 1 : frontX(ttPrev), xNow = tt >= SWD ? -80 : frontX(tt);
      const iOf = (x) => t * fps + 4096 - (headX - x) / fw;
      for (let i = Math.ceil(iOf(xNow)); i <= Math.floor(iOf(xPrev)); i++) {
        const b = (i - 4096) / fps, bph = b - L * Math.floor(b / L), s = spike(i, seed) * (1 - birthCalm(bph));
        if (s < 0.1 || isOn(bph) || b > t - tt || b < t - ph - (L - OFF0)) continue;
        const x = frameX(i, fw, fps), v = baseV(i, seed) + s;
        burst(x, y0 + v * A * 0.6, Math.round(6 + s * 40), [CYAN, heat(v)], 260 + s * 700, false, 0.9);
      }
      if (tt < SWD) burst(xNow, y0 + rnd(0, A * 0.9), 3, [CYAN, [0.85, 0.97, 1]], 160, true, 0.8);
    }
    lastPh = ph;

    flash *= Math.exp(-dt * 3.5);
    pulse *= Math.exp(-dt * 1.1);
    glitch *= Math.exp(-dt * 7);
    shakeX = flash > 0.05 ? flash * 3 * Math.sin(t * 83) : 0;
    shakeY = flash > 0.05 ? flash * 4 * Math.sin(t * 97) : 0;
    warmth += ((on ? 0 : 0.55 + 0.45 * Math.min(1, flash)) - warmth) * (1 - Math.exp(-dt * 2.5));

    const drift = mouse.seen ? 0 : 1;
    const tx = mouse.tx + drift * 0.45 * Math.sin(t * 0.21), ty = mouse.ty + drift * 0.3 * Math.sin(t * 0.13 + 1);
    mouse.x += (tx - mouse.x) * (1 - Math.exp(-dt * 2.5));
    mouse.y += (ty - mouse.y) * (1 - Math.exp(-dt * 2.5));

    for (const r of rings) r.age += dt;
    while (rings.length && rings[0].age > 2.6) rings.shift();
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      p.life += dt;
      if (p.life >= p.max || p.y < -20) { parts[k] = parts[parts.length - 1]; parts.pop(); continue; }
      const d = Math.exp(-dt * p.drag);
      p.vx *= d; p.vy = p.vy * d - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < 0 && p.vy < 0) { p.y = 0; p.vy *= -0.35; p.vx *= 0.7; }   // bounce on the near floor edge
    }
    for (const m of motes) { m.x -= dt * 0.012 * m.z; if (m.x < -0.05) { m.x = 1.05; m.y = Math.random(); } m.p += dt * (0.6 + m.z); }

    hudT -= dt;
    if (hud && hudT <= 0) { hudT = 0.1; updateHud(); }
  }

  // ---- the overlay card: every number comes from the same frames, over the current phase ----
  // FPS and frame time: the mean of the last FPS_WIN frames (half a second of the graph). 1% low: the mean of the 3 slowest frames in the phase,
  // 0.1% low: the slowest one. The FPS frames are part of the phase, so 0.1% low <= 1% low <= FPS always holds.
  function updateHud() {
    const n = win.length;
    if (!n) return;
    const recent = win.slice(-FPS_WIN), worst = win.slice().sort((a, b) => b - a);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const ms = mean(recent) * 100, fps = 1000 / ms;
    const low1 = 1000 / (mean(worst.slice(0, 3)) * 100), low01 = 1000 / (worst[0] * 100);
    O.fps.textContent = Math.round(fps);
    O.ms.textContent = ms.toFixed(1);
    O.low.textContent = Math.round(low1);
    O.low01.textContent = Math.round(low01);
    O.hitch.textContent = count;
    hud.dataset.grade = fps < 60 ? 'bad' : fps < 90 ? 'warn' : 'good';
    hud.dataset.low = low1 < 30 ? 'bad' : low1 < 60 ? 'warn' : 'good';
    stats.hud = { on: wasOn, fps, ms, low1, low01, hitches: count, frames: n };
    drawHudGraph();
  }
  function setHudState(on) {
    if (!hud) return;
    hud.classList.toggle('on', on);
    O.state.textContent = on ? 'SCSKiller on' : 'SCSKiller off';
    O.cache.textContent = on ? 'warm' : 'cold';
    O.hitch.textContent = count;
  }
  // the mini graph: the last GRAPH_N frames exactly as the big trace draws them (so the fix wave clears it too)
  function drawHudGraph() {
    const w0 = hudCanvas.clientWidth, h0 = hudCanvas.clientHeight;
    if (!w0) return;
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (hudCanvas.width !== Math.round(w0 * d)) { hudCanvas.width = Math.round(w0 * d); hudCanvas.height = Math.round(h0 * d); }
    const w = hudCanvas.width, h = hudCanvas.height, bw = w / GRAPH_N, [fw, fps, seed] = MAIN, top = 0.6;   // 60 ms at the top
    hg.clearRect(0, 0, w, h);
    hg.fillStyle = 'rgba(160,190,220,0.22)';
    for (let x = 0; x < w; x += 6 * d) hg.fillRect(x, h - (HITCH / top) * h, 3 * d, d);   // the 20 ms line
    for (let k = 0; k < GRAPH_N; k++) {
      const i = lastI - (GRAPH_N - 1 - k), v = frameV(i, seed, fps, fw), bh = Math.max(2 * d, Math.min(1, v / top) * h);
      hg.fillStyle = `rgb(${heat(v).map((x) => Math.round(Math.min(1, x) * 255))})`;
      hg.fillRect(k * bw, h - bh, Math.max(1, bw - d), bh);
    }
  }

  // particle instances: x, y, vx, vy (css px), r, g, b, size
  const inst = new Float32Array((MAX_PARTS + motes.length) * 8);
  function packParticles(W, H) {
    let n = 0;
    for (const p of parts) {
      const k = 1 - p.life / p.max, a = k * k * 2.4, o = n * 8;
      inst[o] = p.x; inst[o + 1] = p.y; inst[o + 2] = p.vx; inst[o + 3] = p.vy;
      inst[o + 4] = p.c[0] * a; inst[o + 5] = p.c[1] * a; inst[o + 6] = p.c[2] * a; inst[o + 7] = p.size;
      n++;
    }
    const tint = [CYAN[0] + (WARM[0] - CYAN[0]) * warmth, CYAN[1] + (WARM[1] - CYAN[1]) * warmth, CYAN[2] + (WARM[2] - CYAN[2]) * warmth];
    for (const m of motes) {
      const o = n * 8, a = (0.12 + 0.18 * (0.5 + 0.5 * Math.sin(m.p))) * m.z;
      inst[o] = m.x * W - mouse.x * 40 * m.z; inst[o + 1] = H * (0.08 + m.y * 0.92) + mouse.y * 16 * m.z;
      inst[o + 2] = -30 * m.z; inst[o + 3] = 0;
      inst[o + 4] = tint[0] * a; inst[o + 5] = tint[1] * a; inst[o + 6] = tint[2] * a; inst[o + 7] = 0.6 + 1.6 * m.z;
      n++;
    }
    return n;
  }

  // ---- WebGL2 ----
  const VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const traceCall = ([fw, fps, seed, amp, alpha, glow, reach, par], fill) =>
    `col += trace(p, ${fw.toFixed(1)}*S, ${fps.toFixed(1)}, ${seed}u, y0 + M.y*${(par * 0.4).toFixed(1)}*S, A*${amp.toFixed(2)}, ${reach}, ${glow.toFixed(1)}*S, ${alpha.toFixed(2)}, HX - M.x*${par.toFixed(1)}*S, ${fill});`;
  const SCENE_FS = `#version 300 es
precision highp float; precision highp int;
uniform vec2 R, M; uniform float T, S, HX, HV, F, P, W;
uniform vec4 RG[4];
out vec4 o;
const float L = ${L.toFixed(1)}, SW0 = ${SW0.toFixed(1)}, SWD = ${SWD.toFixed(2)}, OFF0 = ${OFF0.toFixed(1)}, OFF1 = ${OFF1.toFixed(1)};
const vec3 CY = vec3(0.30, 0.76, 1.0), WM = vec3(1.0, 0.42, 0.25);
float hash(uint x){ x^=x>>16u; x*=0x7feb352du; x^=x>>15u; x*=0x846ca68bu; x^=x>>16u; return float(x)*(1.0/4294967295.0); }
float frontX(float tt){ return HX - (HX + 80.0*S) * smoothstep(0.0, SWD, tt); }
float calmOf(float b, float x){
  float n = floor(b / L), ph = b - n*L;
  if (ph >= SW0 && ph < OFF0) return 1.0;
  float c0 = ph < SW0 ? 0.0 : 1.0 - smoothstep(OFF0, OFF1, ph);
  float tt = T - ((ph < SW0 ? n : n + 1.0)*L + SW0);
  if (tt <= 0.0) return c0;
  if (tt >= SWD) return 1.0;
  return mix(c0, 1.0, smoothstep(0.0, 40.0*S, x - frontX(tt)));
}
float frameV(uint i, uint seed, float fps, float x){
  uint k = i*3u + seed;
  float r = hash(k+1u), h = hash(k+2u);
  float s = r > 0.93 ? 0.18 + 0.8*h*h : (r > 0.84 ? 0.06 + 0.1*h : 0.0);
  return 0.075 + 0.03*hash(k) + s*(1.0 - calmOf((float(i) - 4096.0)/fps, x));
}
float seg(vec2 p, vec2 a, vec2 b){ vec2 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
vec3 heat(float v){
  vec3 c = mix(CY, vec3(1.0,0.71,0.33), smoothstep(0.14,0.30,v));
  return mix(c, vec3(1.0,0.33,0.28), smoothstep(0.40,0.75,v));
}
vec3 trace(vec2 p, float fw, float fps, uint seed, float y0, float A, int reach, float glow, float alpha, float hx, bool fill){
  float u = (p.x - hx)/fw + T*fps + 4096.0;
  float i0 = floor(u);
  float xa = (i0 - float(reach) - u)*fw + p.x;
  uint ia = uint(i0) - uint(reach);
  float va = frameV(ia, seed, fps, xa);
  vec2 a = vec2(xa, y0 + va*A);
  float best = 1e9, bv = 0.0, yl = -1.0, vl = 0.0;
  for (int k = 0; k <= 2*reach; k++) {
    if (xa >= hx) break;
    float xb = xa + fw; uint ib = ia + 1u;
    float vb = frameV(ib, seed, fps, xb);
    vec2 b = vec2(xb, y0 + vb*A);
    vec2 bc = xb > hx ? mix(a, b, (hx - xa)/fw) : b;
    float d = seg(p, a, bc);
    if (d < best) { best = d; bv = max(va, vb); }
    if (p.x >= xa && p.x < min(xb, hx)) { float m = (p.x - xa)/fw; yl = mix(a.y, b.y, m); vl = mix(va, vb, m); }
    a = b; va = vb; xa = xb; ia = ib;
  }
  float hot = 1.0 + 0.9*smoothstep(0.2, 0.8, bv);
  float core = 1.0 - smoothstep(0.6*S, 1.7*S, best);
  float fade = mix(0.25, 1.0, smoothstep(0.0, 0.45*R.x, p.x));
  float halo = max(0.0, exp(-best/glow) - exp(-float(reach)*fw/glow));
  vec3 c = heat(bv) * (1.5*core + 0.6*halo) * hot;
  if (fill && yl > y0 && p.y > y0 && p.y < yl) {
    float k = (p.y - y0)/(yl - y0);
    c += heat(vl) * (0.04 + 0.2*k*k*k) * (0.6 + 0.8*smoothstep(0.15, 0.6, vl));
  }
  return c * alpha * fade;
}
void main(){
  vec2 p = gl_FragCoord.xy, q = p/R;
  float y0 = ${Y0}*R.y, A = ${AMP}*R.y;
  vec3 tint = mix(CY, WM, W);
  // sky: deep gradient, a horizon glow that warms with stutter, a nebula behind the head
  vec3 col = mix(vec3(0.010, 0.014, 0.024), vec3(0.018, 0.026, 0.045), q.y);
  col += tint * 0.06 * exp(-abs(p.y - y0)/(0.16*R.y));
  col += tint * 0.09 * exp(-length((p - vec2(HX - M.x*40.0*S, y0 + 0.35*A)) * vec2(0.6, 1.0))/(0.45*R.y));
  col += vec3(0.20, 0.10, 0.45) * 0.035 * exp(-length(p - vec2(0.15*R.x + M.x*60.0*S, 0.85*R.y))/(0.5*R.y));
  if (p.y >= y0) {
    // one faint time line per second, scrolling with the graph; a dashed line at 20 ms, the hitch threshold
    float gx = (p.x - HX)/(${SPEED.toFixed(1)}*S) + T;
    float d = abs(fract(gx + 0.5) - 0.5) * ${SPEED.toFixed(1)}*S;
    col += vec3(0.5, 0.62, 0.78) * 0.05 * (1.0 - smoothstep(0.0, S, d)) * (1.0 - smoothstep(y0, y0 + 1.1*A, p.y));
    float dash = step(0.5, fract(p.x/(10.0*S)));
    float l1 = 1.0 - smoothstep(0.0, S, abs(p.y - (y0 + ${HITCH.toFixed(2)}*A)));
    col += vec3(0.55, 0.65, 0.78) * 0.14 * dash * l1;
  } else {
    // the floor: a perspective grid that scrolls with the graph and reflects it (reflection in the composite)
    float v = (y0 - p.y)/y0;
    float vpx = HX*0.55 + M.x*80.0*S;
    vec2 g = vec2((p.x - vpx)/(max(v, 0.002)*150.0*S) + T*${(SPEED / 150).toFixed(4)}, 0.6/max(v, 0.002));
    vec2 w = fwidth(g);
    vec2 gl = abs(fract(g - 0.5) - 0.5) / max(w, 1e-4);
    float line = (1.0 - min(min(gl.x, gl.y), 1.0)) * smoothstep(0.0, 0.3, v);
    col = vec3(0.006, 0.009, 0.016) + tint * 0.04 * (1.0 - v);
    float lit = exp(-length(vec2((p.x - HX)/3.5, p.y - y0))/(70.0*S));
    col += line * tint * (0.16 + 0.9*lit + 1.2*F*lit);
    float tt = mod(T, L) - SW0;
    if (tt > 0.0 && tt < SWD + 0.6) {
      float xf = tt < SWD ? frontX(tt) : -80.0*S;
      float env = 1.0 - smoothstep(SWD*0.6, SWD + 0.5, tt);
      col += CY * env * (line * 1.6 + 0.12) * exp(-abs(p.x - xf)/(70.0*S)) * (0.3 + v);
    }
  }
  // baseline
  col += tint * 0.5 * (1.0 - smoothstep(0.0, 1.2*S, abs(p.y - y0)));
  if (p.y < y0 + 1.15*A + 80.0*S && p.x < HX + 60.0*S) {
    ${traceCall(FAR, 'false')}
    ${traceCall(GHOST, 'false')}
    ${traceCall(MAIN, 'true')}
  }
  // write head: a hot point and an anamorphic streak; hitches flash warm, the fix pulses cyan
  vec2 h = vec2(HX, y0 + HV*A);
  vec2 dh2 = p - h; float dh = length(dh2);
  vec3 hc = mix(heat(HV), vec3(1.0), 0.45);
  col += hc * (2.4*exp(-dh/(2.5*S)) + 0.4*exp(-dh/(18.0*S)));
  col += hc * (0.35 + 1.4*F + 1.6*P) * exp(-abs(dh2.y)/(1.1*S)) * exp(-abs(dh2.x)/((180.0 + 300.0*P)*S));
  float bandY = smoothstep(y0 - 6.0*S, y0, p.y) * (1.0 - smoothstep(y0 + 0.9*A, y0 + 1.3*A, p.y));
  col += WM * F * (0.5*exp(-dh/(110.0*S)) + 0.5*bandY*exp(-abs(p.x - HX)/(2.5*S)));
  col += CY * P * (0.5*exp(-dh/(200.0*S)) + 0.8*bandY*exp(-abs(p.x - HX)/(3.0*S)));
  // the fix wave
  float tt = mod(T, L) - SW0;
  if (tt > 0.0 && tt < SWD + 0.6) {
    float xf = tt < SWD ? frontX(tt) : -80.0*S;
    float env = (1.0 - smoothstep(SWD*0.6, SWD + 0.5, tt)) * smoothstep(0.0, 0.06, tt);
    float dx = p.x - xf, mask = 1.0 - 0.8*smoothstep(y0 + 0.5*A, R.y, p.y);
    col += CY * env * mask * (3.0*exp(-abs(dx)/(1.6*S)) + 0.7*exp(-abs(dx)/(26.0*S)) + 0.22*exp(-abs(dx)/(170.0*S)));
    col += CY * 0.07 * env * step(0.0, dx) * exp(-dx/(420.0*S)) * step(y0, p.y);
  }
  // shock rings (warm = hitch, cyan = fix)
  for (int i = 0; i < 4; i++) {
    vec4 r = RG[i];
    if (r.w == 0.0) continue;
    float rad = S * (20.0 + 1500.0*(1.0 - exp(-r.z*2.2)));
    float d = abs(length((p - r.xy) * vec2(1.0, 1.25)) - rad);
    float a = abs(r.w) * exp(-r.z*1.9);
    col += (r.w > 0.0 ? WM : CY) * a * (0.9*exp(-d/(1.8*S)) + 0.22*exp(-d/(30.0*S)));
  }
  o = vec4(col, 1.0);
}`;
  const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D S0; uniform vec2 TX, OR; uniform float TH;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / OR;
  vec3 c = texture(S0, uv).rgb*4.0 + texture(S0, uv - TX).rgb + texture(S0, uv + TX).rgb
         + texture(S0, uv + vec2(TX.x, -TX.y)).rgb + texture(S0, uv - vec2(TX.x, -TX.y)).rgb;
  c /= 8.0;
  if (TH > 0.0) c = max(c - TH, 0.0);
  o = vec4(c, 1.0);
}`;
  const UP_FS = `#version 300 es
precision highp float;
uniform sampler2D S0; uniform vec2 TX, OR;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / OR, h = TX;
  vec3 c = texture(S0, uv + vec2(-2.0*h.x, 0.0)).rgb + texture(S0, uv + vec2(2.0*h.x, 0.0)).rgb
         + texture(S0, uv + vec2(0.0, 2.0*h.y)).rgb + texture(S0, uv + vec2(0.0, -2.0*h.y)).rgb
         + 2.0*(texture(S0, uv + h).rgb + texture(S0, uv - h).rgb + texture(S0, uv + vec2(h.x, -h.y)).rgb + texture(S0, uv + vec2(-h.x, h.y)).rgb);
  o = vec4(c / 12.0, 1.0);
}`;
  const COMP_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D SC, BL; uniform vec2 R, SH; uniform float CA, GL, T, BI;
out vec4 o;
float hash(uint x){ x^=x>>16u; x*=0x7feb352du; x^=x>>15u; x*=0x846ca68bu; x^=x>>16u; return float(x)*(1.0/4294967295.0); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  // a big hitch tears the picture for a few frames
  uint band = uint(uv.y * 40.0), tick = uint(T * 30.0);
  float g = hash(band*7u + tick*131u);
  uv.x += g > 0.8 ? (hash(band + tick*17u) - 0.5) * 0.03 * GL : 0.0;
  uv += SH / R;
  vec2 ca = vec2(CA, 0.0) / R;
  vec3 c = vec3(texture(SC, uv + ca).r, texture(SC, uv).g, texture(SC, uv - ca).b);
  vec3 b = texture(BL, uv).rgb;
  float y0 = ${Y0};
  if (uv.y < y0) {   // glossy floor: the graph and its glow, mirrored and fading toward the viewer
    vec2 r = vec2(uv.x, 2.0*y0 - uv.y);
    float f = 1.0 - (y0 - uv.y)/y0;
    c += texture(SC, r).rgb * 0.16 * f*f*f;
    b += texture(BL, r).rgb * 0.6 * f*f;
  }
  c = aces((c + b*BI) * 1.05);
  vec2 v = uv - 0.5;
  c *= 1.0 - 0.45*dot(v*vec2(1.1, 1.3), v*vec2(1.1, 1.3));
  c += (hash(uint(gl_FragCoord.x) + uint(gl_FragCoord.y)*4099u + tick*977u) - 0.5) / 160.0;
  o = vec4(c, 1.0);
}`;
  const PART_VS = `#version 300 es
in vec2 C; in vec4 PV; in vec4 CS;
uniform vec2 R; uniform float S;
out vec2 c; out vec3 col;
void main(){
  vec2 v = PV.zw; float sp = length(v);
  vec2 d = sp > 1.0 ? v/sp : vec2(1.0, 0.0), n = vec2(-d.y, d.x);
  float len = CS.w*1.4 + sp*0.028;
  vec2 pos = (PV.xy + d*C.x*len + n*C.y*CS.w) * S;
  gl_Position = vec4(pos / R * 2.0 - 1.0, 0.0, 1.0);
  c = C; col = CS.rgb;
}`;
  const PART_FS = `#version 300 es
precision mediump float;
in vec2 c; in vec3 col; out vec4 o;
void main(){ float f = max(0.0, 1.0 - dot(c, c)); o = vec4(col * f * f, 1.0); }`;

  function initGL() {
    if (/[?&]r=2d\b/.test(location.search)) return null;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) console.error('[scene] shader:', gl.getShaderInfoLog(s));
      return s;
    };
    const prog = (vs, fs, names) => {
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { if (!gl.isContextLost()) console.error('[scene] link:', gl.getProgramInfoLog(p)); return null; }
      const u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, n);
      return { p, u };
    };
    const scene = prog(VS, SCENE_FS, ['R', 'M', 'T', 'S', 'HX', 'HV', 'F', 'P', 'W', 'RG']);
    const down = prog(VS, DOWN_FS, ['S0', 'TX', 'OR', 'TH']);
    const up = prog(VS, UP_FS, ['S0', 'TX', 'OR']);
    const comp = prog(VS, COMP_FS, ['SC', 'BL', 'R', 'SH', 'CA', 'GL', 'T', 'BI']);
    const part = prog(PART_VS, PART_FS, ['R', 'S']);
    if (!scene || !down || !up || !comp || !part) return null;

    const hdr = !!gl.getExtension('EXT_color_buffer_float');
    const fmt = hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
    let levels = [];
    const makeLevels = () => {
      for (const l of levels) { gl.deleteTexture(l.tex); gl.deleteFramebuffer(l.fb); }
      levels = [];
      for (let k = 0; k <= 6; k++) {
        const w = Math.max(1, cw >> k), h = Math.max(1, ch >> k);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, fmt[1], fmt[2], null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        levels.push({ tex, fb, w, h });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    // particles: one quad, instanced
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const locC = gl.getAttribLocation(part.p, 'C'), locPV = gl.getAttribLocation(part.p, 'PV'), locCS = gl.getAttribLocation(part.p, 'CS');
    gl.enableVertexAttribArray(locC); gl.vertexAttribPointer(locC, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(locPV); gl.vertexAttribPointer(locPV, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(locPV, 1);
    gl.enableVertexAttribArray(locCS); gl.vertexAttribPointer(locCS, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(locCS, 1);
    gl.bindVertexArray(null);
    const empty = gl.createVertexArray();
    const rg = new Float32Array(16);

    const pass = (target, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.viewport(0, 0, w, h); };
    const bindTex = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };

    return {
      name: hdr ? 'webgl2-hdr' : 'webgl2',
      resize: makeLevels,
      draw() {
        if (!levels.length || levels[0].w !== cw || levels[0].h !== ch) makeLevels();
        const W = cw / scale, H = ch / scale;
        // 1. scene
        pass(levels[0].fb, cw, ch);
        gl.bindVertexArray(empty);
        gl.useProgram(scene.p);
        const u = scene.u;
        gl.uniform2f(u.R, cw, ch); gl.uniform2f(u.M, mouse.x, mouse.y);
        gl.uniform1f(u.T, t); gl.uniform1f(u.S, scale); gl.uniform1f(u.HX, headX * scale); gl.uniform1f(u.HV, headV);
        gl.uniform1f(u.F, flash); gl.uniform1f(u.P, pulse); gl.uniform1f(u.W, warmth);
        rg.fill(0);
        rings.forEach((r, k) => { rg[k * 4] = r.x * scale; rg[k * 4 + 1] = r.y * scale; rg[k * 4 + 2] = r.age; rg[k * 4 + 3] = r.s; });
        gl.uniform4fv(u.RG, rg);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // 2. sparks, additive, into the scene so they bloom
        const n = packParticles(W, H);
        if (n) {
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(part.p);
          gl.uniform2f(part.u.R, cw, ch); gl.uniform1f(part.u.S, scale);
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, ib);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * 8);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
          gl.disable(gl.BLEND);
          gl.bindVertexArray(empty);
        }
        // 3. bloom: threshold + downsample chain, then tent upsample added back up the chain
        gl.useProgram(down.p); gl.uniform1i(down.u.S0, 0);
        for (let k = 1; k < levels.length; k++) {
          const s = levels[k - 1], d = levels[k];
          pass(d.fb, d.w, d.h); bindTex(0, s.tex);
          gl.uniform2f(down.u.TX, 1 / s.w, 1 / s.h); gl.uniform2f(down.u.OR, d.w, d.h); gl.uniform1f(down.u.TH, k === 1 ? (hdr ? 0.75 : 0.45) : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.useProgram(up.p); gl.uniform1i(up.u.S0, 0);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        for (let k = levels.length - 2; k >= 1; k--) {
          const s = levels[k + 1], d = levels[k];
          pass(d.fb, d.w, d.h); bindTex(0, s.tex);
          gl.uniform2f(up.u.TX, 1 / s.w, 1 / s.h); gl.uniform2f(up.u.OR, d.w, d.h);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.BLEND);
        // 4. composite
        pass(null, cw, ch);
        gl.useProgram(comp.p);
        bindTex(0, levels[0].tex); bindTex(1, levels[1].tex);
        gl.uniform1i(comp.u.SC, 0); gl.uniform1i(comp.u.BL, 1);
        gl.uniform2f(comp.u.R, cw, ch); gl.uniform2f(comp.u.SH, shakeX * scale, shakeY * scale);
        gl.uniform1f(comp.u.CA, (0.6 + 3.5 * flash + 1.5 * pulse) * scale); gl.uniform1f(comp.u.GL, glitch);
        gl.uniform1f(comp.u.T, t); gl.uniform1f(comp.u.BI, 0.5 + 0.3 * pulse);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  }

  // ---- Canvas 2D fallback: same frames, sparks and wave; glow from layered strokes instead of bloom ----
  function init2D() {
    const g = canvas.getContext('2d', { alpha: false });
    if (!g) return null;
    const rgb = (c, a) => `rgba(${Math.round(Math.min(1, c[0]) * 255)},${Math.round(Math.min(1, c[1]) * 255)},${Math.round(Math.min(1, c[2]) * 255)},${a})`;
    const BUCKETS = 6, colors = Array.from({ length: BUCKETS }, (_, i) => heat(0.1 + i * 0.13));
    return {
      name: '2d',
      resize() {},
      draw() {
        const s = scale, w = cw, h = ch, Y = (yUp) => h - yUp * s;
        const y0 = (ch / s) * Y0, A = (ch / s) * AMP, tint = CYAN.map((c, k) => c + (WARM[k] - c) * warmth);
        g.save();
        g.translate(shakeX * s, shakeY * s);
        const sky = g.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#060910'); sky.addColorStop(1 - Y0, rgb(tint.map((c) => c * 0.12), 1)); sky.addColorStop(1 - Y0 + 0.001, '#030509'); sky.addColorStop(1, '#05080d');
        g.fillStyle = sky; g.fillRect(-20, -20, w + 40, h + 40);
        // floor grid
        const vpx = headX * 0.55 * s + mouse.x * 80 * s, hy = Y(y0);
        g.lineWidth = s; g.strokeStyle = rgb(tint, 0.18); g.beginPath();
        const off = (t * SPEED / 150) % 1;
        for (let k = -40; k <= 40; k++) { const x = vpx + (k - off) * 150 * s; g.moveTo(vpx + (x - vpx) * 0.3, hy + (h - hy) * 0.3); g.lineTo(x, h); }
        for (let z = 1; z < 30; z++) { const v = 0.6 / (z + 0.0); if (v > 1) continue; const y = hy + (h - hy) * v; g.moveTo(0, y); g.lineTo(w, y); }
        g.stroke();
        g.strokeStyle = rgb(tint, 0.6); g.beginPath(); g.moveTo(0, hy); g.lineTo(w, hy); g.stroke();
        // ms lines
        g.setLineDash([5 * s, 5 * s]); g.strokeStyle = 'rgba(140,166,191,0.18)'; g.beginPath();
        for (const f of [HITCH]) { g.moveTo(0, Y(y0 + f * A)); g.lineTo(w, Y(y0 + f * A)); }
        g.stroke(); g.setLineDash([]);
        g.globalCompositeOperation = 'lighter'; g.lineJoin = 'round';
        for (const [fwCss, fps, seed, amp, alpha, , , par] of [FAR, GHOST, MAIN]) {
          const hx = (headX - mouse.x * par), fw = fwCss, u0 = t * fps + 4096, i0 = Math.floor(u0), n = Math.ceil(hx / fw) + 2;
          const paths = Array.from({ length: BUCKETS }, () => new Path2D());
          let xa = hx - (u0 - i0 + n) * fw, va = frameV(i0 - n, seed, fps, fw);
          for (let k = -n + 1; k <= 1; k++) {
            let xb = xa + fw, vb = frameV(i0 + k, seed, fps, fw);
            const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.round((Math.max(va, vb) - 0.1) / 0.13)));
            if (xb > hx) { vb = va + (vb - va) * (hx - xa) / fw; xb = hx; }
            paths[bucket].moveTo(xa * s, Y(y0 + va * A * amp)); paths[bucket].lineTo(xb * s, Y(y0 + vb * A * amp));
            xa = xb; va = vb;
          }
          for (const [lw, a] of [[10, 0.06], [4, 0.14], [1.5, 1]]) {
            g.lineWidth = lw * s;
            paths.forEach((p, i) => { g.strokeStyle = rgb(colors[i], a * alpha); g.stroke(p); });
          }
        }
        // head
        const hx = headX * s, hyy = Y(y0 + headV * A);
        const grad = g.createRadialGradient(hx, hyy, 0, hx, hyy, (16 + 90 * flash + 120 * pulse) * s);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.15, rgb(flash > pulse ? heat(headV) : CYAN, 0.5)); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad; g.fillRect(hx - 220 * s, hyy - 220 * s, 440 * s, 440 * s);
        // fix wave
        const tt = t - L * Math.floor(t / L) - SW0;
        if (tt > 0 && tt < SWD + 0.6) {
          const xf = (tt < SWD ? frontX(tt) : -80) * s, env = (1 - ss(SWD * 0.6, SWD + 0.5, tt)) * ss(0, 0.06, tt);
          const bg = g.createLinearGradient(xf - 60 * s, 0, xf + 60 * s, 0);
          bg.addColorStop(0, 'rgba(76,194,255,0)'); bg.addColorStop(0.5, `rgba(160,225,255,${env})`); bg.addColorStop(1, 'rgba(76,194,255,0)');
          g.fillStyle = bg; g.fillRect(xf - 60 * s, 0, 120 * s, h);
        }
        // rings
        for (const r of rings) {
          const rad = (20 + 1500 * (1 - Math.exp(-r.age * 2.2))) * s, a = Math.abs(r.s) * Math.exp(-r.age * 1.9);
          g.strokeStyle = rgb(r.s > 0 ? WARM : CYAN, Math.min(1, a)); g.lineWidth = 2 * s;
          g.beginPath(); g.ellipse(r.x * s, Y(r.y), rad, rad / 1.25, 0, 0, Math.PI * 2); g.stroke();
        }
        // sparks and motes
        const n = packParticles(cw / s, ch / s);
        g.lineCap = 'round';
        for (let k = 0; k < n; k++) {
          const o = k * 8, x = inst[o] * s, y = Y(inst[o + 1]), vx = inst[o + 2] * 0.028 * s, vy = -inst[o + 3] * 0.028 * s;
          g.strokeStyle = rgb([inst[o + 4], inst[o + 5], inst[o + 6]], 1); g.lineWidth = inst[o + 7] * 1.6 * s;
          g.beginPath(); g.moveTo(x - vx, y - vy); g.lineTo(x + vx + 0.1, y + vy); g.stroke();
        }
        g.restore();
      },
    };
  }

  let r = initGL() || init2D();
  if (!r) return;
  stats.renderer = r.name;
  console.info('[scene] renderer:', r.name);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); r = null; });
  canvas.addEventListener('webglcontextrestored', () => { r = initGL(); if (r) { resize(); start(); } });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const s = Math.min(window.devicePixelRatio || 1, DPR_CAP, Math.sqrt(MAX_PIXELS / (w * h)));
    cw = Math.max(1, Math.round(w * s)); ch = Math.max(1, Math.round(h * s));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    scale = cw / w;
    headX = w * (w < 700 ? 0.86 : 0.8);
    if (r) { r.resize(); r.draw(); }
  }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = canvas.getBoundingClientRect();
    mouse.seen = true;
    mouse.tx = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width) * 2 - 1));
    mouse.ty = Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height) * 2 - 1));
  }, { passive: true });

  function frame(now) {
    raf = 0;
    if (!running || !r) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    step(dt);
    r.draw();
    if (dt) stats.fps = stats.fps * 0.9 + (1 / dt) * 0.1;
    stats.t = t;
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (running || !r || !visible || !onScreen) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; onScreen ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; visible ? start() : stop(); });
  resize();
  step(0);
  if (hud) updateHud();
  start();
})();
