/* ══════════════════════════════════════════════════════════════
   °CRYO MONGOLIA — cryo3d.js
   1) WebGL raymarched 3D brand emblem hero (no libraries, ~0 deps)
   2) CSS-3D interaction layer: tilt cards, device coverflow,
      scroll reveal, magnetic buttons, cursor halo, parallax
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ════════════════════════════════════════════════════════════
     1. WEBGL — 3D BRAND EMBLEM
     ════════════════════════════════════════════════════════════ */

  const VERT = `
    attribute vec2 aPos;
    void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
  precision highp float;

  uniform vec2  uRes;
  uniform float uTime;
  uniform vec2  uMouse;     // -1..1, smoothed
  uniform float uScroll;    // 0..1 hero scroll progress

  const float PI = 3.14159265;

  /* brand palette */
  const vec3 STAR_COL  = vec3(0.478, 0.714, 0.988);   /* #7ab6fc */
  const vec3 ARROW_COL = vec3(0.031, 0.416, 0.973);   /* #086af8 */

  mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

  float hash13(vec3 p){
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x){
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
          mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
          mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  float fbm(vec3 p){
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++){ s += a * noise(p); p *= 2.04; a *= 0.5; }
    return s;
  }

  /* ── 2D: eight-pointed star ── */
  float sdStar(vec2 p, float r, float n, float m){
    float an = PI / n;
    float en = PI / m;
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));
    float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
  }

  /* ── 2D: distance to one polygon edge ── */
  float segD(vec2 p, vec2 a, vec2 b){
    vec2 w = p - a, e = b - a;
    vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    return dot(q, q);
  }
  float segS(vec2 p, vec2 a, vec2 b){
    vec2 w = p - a, e = b - a;
    bvec3 c = bvec3(p.y >= a.y, p.y < b.y, e.x * w.y > e.y * w.x);
    return (all(c) || all(not(c))) ? -1.0 : 1.0;
  }

  /* ── 2D: navigation / send arrow (4 vertices, pointing up) ── */
  float sdArrow(vec2 p, float s){
    vec2 v0 = vec2( 0.000,  1.320) * s;   /* tip        */
    vec2 v1 = vec2( 0.640, -0.980) * s;   /* right wing */
    vec2 v2 = vec2( 0.000, -0.380) * s;   /* tail notch */
    vec2 v3 = vec2(-0.640, -0.980) * s;   /* left wing  */

    float d = min(min(segD(p, v0, v1), segD(p, v1, v2)),
                  min(segD(p, v2, v3), segD(p, v3, v0)));
    float sg = segS(p, v0, v1) * segS(p, v1, v2) * segS(p, v2, v3) * segS(p, v3, v0);
    return sg * sqrt(d);
  }

  /* ── extrude a 2D field into a rounded slab ── */
  float extrude(float d2, float z, float h, float round){
    vec2 w = vec2(d2 + round, abs(z) - h);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - round;
  }

  /* ── the emblem: light star behind, deep-blue arrow ribbon in front ──
     returns vec2(distance, materialId) : 1 = star, 2 = arrow            */
  vec2 mapLogo(vec3 p){
    /* gentle 3D presentation — never spins edge-on, so it stays legible */
    float t = uTime;
    p.xz *= rot(sin(t * 0.34) * 0.62 + uMouse.x * 0.22);
    p.yz *= rot(sin(t * 0.23 + 1.1) * 0.20 - uMouse.y * 0.14);
    p.y  -= sin(t * 0.55) * 0.045;                  /* slow float */

    /* ── star ── */
    vec2 sp = p.xy * rot(0.20 + sin(t * 0.18) * 0.05);
    float star2 = sdStar(sp, 1.26, 8.0, 3.05);
    float star  = extrude(star2, p.z - 0.10, 0.115, 0.028);

    /* ── arrow: outer body minus an inner copy leaves the ribbon ── */
    vec2 ap = (p.xy - vec2(0.02, -0.02)) * rot(-0.87);   /* points up-right */
    float arrow2 = sdArrow(ap, 0.94);
    float arrow  = extrude(arrow2, p.z - 0.30, 0.135, 0.05);

    vec2 res = vec2(star, 1.0);
    if (arrow < res.x) res = vec2(arrow, 2.0);
    return res;
  }

  vec3 normalAt(vec3 p){
    vec2 e = vec2(0.0022, 0.0);
    return normalize(vec3(
      mapLogo(p + e.xyy).x - mapLogo(p - e.xyy).x,
      mapLogo(p + e.yxy).x - mapLogo(p - e.yxy).x,
      mapLogo(p + e.yyx).x - mapLogo(p - e.yyx).x));
  }

  /* studio environment the emblem reflects */
  vec3 envColor(vec3 rd){
    float up = rd.y * 0.5 + 0.5;
    vec3 sky = mix(vec3(0.014, 0.032, 0.066), vec3(0.09, 0.30, 0.54), pow(up, 1.4));
    float k1 = pow(max(dot(rd, normalize(vec3(-0.55, 0.62, 0.55))), 0.0), 20.0);
    float k2 = pow(max(dot(rd, normalize(vec3( 0.80, 0.15, 0.55))), 0.0), 10.0);
    sky += vec3(0.80, 0.94, 1.00) * k1 * 1.4;
    sky += vec3(0.16, 0.52, 0.90) * k2 * 0.6;
    return sky;
  }

  /* cold haze drifting behind the emblem */
  float mistDensity(vec3 p){
    vec3 q = p;
    q.y += uTime * 0.16;
    q.xz *= rot(uTime * 0.035);
    float n = fbm(q * 0.85);
    float shell = smoothstep(3.0, 0.85, length(p.xz));
    float band  = smoothstep(2.1, -1.6, p.y);
    return max(0.0, n - 0.47) * shell * band;
  }

  void main(){
    float wide = smoothstep(1.05, 1.65, uRes.x / uRes.y);
    float cx = mix(0.50, 0.735, wide);
    float cy = mix(0.42, 0.52, wide);
    vec2 uv = (gl_FragCoord.xy - vec2(uRes.x * cx, uRes.y * cy)) / uRes.y;

    /* camera */
    vec3 ro = vec3(0.0, 0.05, 7.60);
    vec3 target = vec3(0.0);
    float ax = uMouse.x * 0.20;
    float ay = uMouse.y * 0.14 - uScroll * 0.28;
    ro.yz *= rot(-ay);
    ro.xz *= rot(ax);

    vec3 fwd = normalize(target - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up  = cross(fwd, rgt);
    vec3 rd  = normalize(uv.x * rgt + uv.y * up + 1.75 * fwd);

    vec3 bg  = envColor(rd) * 0.55;
    vec3 col = bg;

    /* ── raymarch the emblem ── */
    float t = 0.0;
    float mat = 0.0;
    bool hit = false;
    for (int i = 0; i < 90; i++){
      vec3 p = ro + rd * t;
      vec2 h = mapLogo(p);
      if (h.x < 0.0015){ hit = true; mat = h.y; break; }
      if (t > 11.0) break;
      t += h.x * 0.85;
    }

    if (hit){
      vec3 p = ro + rd * t;
      vec3 n = normalAt(p);

      vec3 base = (mat < 1.5) ? STAR_COL : ARROW_COL;

      vec3 L1 = normalize(vec3(-0.52, 0.74, 0.62));
      vec3 L2 = normalize(vec3( 0.86, 0.20, 0.44));
      vec3 L3 = normalize(vec3( 0.10, -0.75, 0.35));

      float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.4);

      /* diffuse key + cool fill + warm-ish bounce */
      float k = max(dot(n, L1), 0.0);
      float f = max(dot(n, L2), 0.0);
      float b = max(dot(n, L3), 0.0);

      /* the pale star keeps close to its albedo; the arrow takes the key light */
      float isStar  = step(mat, 1.5);
      float ambGain = mix(0.42, 0.82, isStar);
      float keyGain = mix(1.05, 0.60, isStar);
      float spcGain = mix(0.85, 0.30, isStar);

      col  = base * (ambGain + keyGain * k);
      col += base * vec3(0.55, 0.75, 1.0) * f * mix(0.30, 0.16, isStar);
      col += base * 0.22 * b;

      /* glossy coat */
      col += vec3(1.0) * pow(max(dot(reflect(-L1, n), -rd), 0.0), 120.0) * spcGain;
      col += vec3(0.70, 0.88, 1.0) * pow(max(dot(reflect(-L2, n), -rd), 0.0), 46.0) * spcGain * 0.6;

      /* reflected studio + rim */
      col += envColor(reflect(rd, n)) * (0.06 + 0.22 * fres) * mix(1.0, 0.45, isStar);
      col += mix(base, vec3(1.0), 0.45) * pow(fres, 2.4) * mix(0.30, 0.14, isStar);

      /* the arrow reads brighter so it stays legible over the star */
      if (mat > 1.5) col *= 1.30;
    }

    /* ── haze ── */
    float fogAcc = 0.0;
    float tm = 2.60;
    for (int i = 0; i < 22; i++){
      vec3 p = ro + rd * tm;
      if (hit && tm > t) break;
      fogAcc += mistDensity(p) * 0.10;
      tm += 0.235;
    }
    fogAcc = clamp(fogAcc, 0.0, 1.0);
    vec3 mistCol = mix(vec3(0.14, 0.30, 0.48), vec3(0.70, 0.88, 1.0), 0.32);
    col = mix(col, mistCol, fogAcc * 0.62);

    /* glow pool behind the emblem */
    float halo = 1.0 - smoothstep(0.0, 1.35, length(uv * vec2(1.0, 1.12)));
    col += vec3(0.12, 0.42, 0.85) * pow(max(halo, 0.0), 2.2) * 0.55;

    /* drifting sparkles */
    vec2 sp2 = uv * 8.0;
    sp2.y += uTime * 0.12;
    vec2 cell = floor(sp2);
    float sh = hash13(vec3(cell, 1.0));
    if (sh > 0.965){
      vec2 fq = fract(sp2) - 0.5;
      float tw = 0.55 + 0.45 * sin(uTime * 2.2 + sh * 40.0);
      col += vec3(0.75, 0.92, 1.0) * smoothstep(0.10, 0.0, length(fq)) * tw * 0.8;
    }

    /* grade */
    col = max(col, 0.0);
    col = col / (col + 0.95);
    col = pow(col, vec3(0.86, 0.92, 0.98));
    /* tonemapping desaturates; pull the brand blues back */
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.85);
    col = max(col, 0.0);
    col *= 1.0 - 0.32 * length(uv) * 0.55;

    float fade = 1.0 - smoothstep(0.35, 1.0, uScroll);
    gl_FragColor = vec4(col * fade, 1.0);
  }
  `;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("[cryo3d] shader:", gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function initHeroGL() {
    const canvas = document.getElementById("cryoCanvas");
    if (!canvas) return;

    const hero = canvas.closest(".hero");
    let gl = null;
    try {
      gl =
        canvas.getContext("webgl", {
          alpha: false,
          antialias: false,
          depth: false,
          powerPreference: "high-performance",
        }) || canvas.getContext("experimental-webgl");
    } catch (e) {
      gl = null;
    }
    if (!gl) {
      canvas.style.display = "none";
      if (hero) hero.classList.add("no-webgl");
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      canvas.style.display = "none";
      if (hero) hero.classList.add("no-webgl");
      return;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[cryo3d] link:", gl.getProgramInfoLog(prog));
      canvas.style.display = "none";
      if (hero) hero.classList.add("no-webgl");
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uScroll = gl.getUniformLocation(prog, "uScroll");

    /* resolution — capped so mid-range laptops stay smooth */
    let dpr = 1;
    let quality = 1;              /* dropped automatically if frames get slow */
    function resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, w > 1400 ? 1.25 : 1.6) * quality;
      const W = Math.max(1, Math.floor(w * dpr));
      const H = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
        gl.viewport(0, 0, W, H);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener("resize", resize, { passive: true });

    /* pointer orbit (smoothed) */
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    window.addEventListener(
      "pointermove",
      (e) => {
        mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
      },
      { passive: true },
    );
    /* gentle gyro orbit on touch devices */
    window.addEventListener(
      "deviceorientation",
      (e) => {
        if (e.gamma == null) return;
        mouse.tx = Math.max(-1, Math.min(1, e.gamma / 35));
        mouse.ty = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 40));
      },
      { passive: true },
    );

    let visible = true;
    if ("IntersectionObserver" in window && hero) {
      new IntersectionObserver(
        (en) => {
          visible = en[0].isIntersecting;
        },
        { threshold: 0 },
      ).observe(hero);
    }

    let scrollP = 0;
    function updateScroll() {
      const h = window.innerHeight || 1;
      scrollP = Math.min(1, Math.max(0, window.scrollY / h));
    }
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });

    const start = performance.now();
    let raf = 0;
    let last = 0;
    let slow = 0;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) {
        last = 0;
        return;
      }

      /* if the GPU can't keep up, render fewer pixels rather than stutter */
      if (last && quality > 0.5) {
        const dt = now - last;
        slow = dt > 34 ? slow + 1 : Math.max(0, slow - 1);
        if (slow > 30) {
          quality = Math.max(0.5, quality - 0.2);
          slow = 0;
          resize();
        }
      }
      last = now;

      mouse.x += (mouse.tx - mouse.x) * 0.045;
      mouse.y += (mouse.ty - mouse.y) * 0.045;

      gl.uniform1f(uTime, REDUCED ? 6.0 : (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uScroll, scrollP);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (REDUCED) cancelAnimationFrame(raf);
    }
    raf = requestAnimationFrame(frame);

    /* release the context if the GPU driver drops it */
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      location.reload();
    });
  }

  /* ════════════════════════════════════════════════════════════
     2. CSS-3D INTERACTION LAYER
     ════════════════════════════════════════════════════════════ */

  /* ── 2a. Hero headline: split into rising words ── */
  function splitHeadline() {
    const title = document.querySelector(".hero-title");
    if (!title || REDUCED) return;
    let delay = 0.28;
    title.querySelectorAll("[data-split]").forEach((node) => {
      const words = node.textContent.trim().split(/\s+/);
      node.textContent = "";
      words.forEach((w, i) => {
        const span = document.createElement("span");
        span.className = "tw";
        const inner = document.createElement("i");
        inner.textContent = w;
        inner.style.animationDelay = delay + i * 0.07 + "s";
        span.appendChild(inner);
        node.appendChild(span);
        if (i < words.length - 1) node.appendChild(document.createTextNode(" "));
      });
      delay += 0.1;
    });
  }

  /* ── 2b. Scroll reveal (+ stagger) ── */
  function initReveal() {
    const els = document.querySelectorAll(".reveal, .stagger");
    if (!("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("visible"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("visible");
          if (e.target.classList.contains("stagger")) {
            [...e.target.children].forEach((c, i) => {
              c.style.transitionDelay = i * 0.075 + "s";
            });
          }
          obs.unobserve(e.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );
    els.forEach((el) => obs.observe(el));
  }

  /* ── 2c. 3D tilt + glare on cards ── */
  function initTilt() {
    if (REDUCED || window.matchMedia("(hover: none)").matches) return;
    const cards = document.querySelectorAll("[data-tilt]");
    cards.forEach((card) => {
      if (!card.querySelector(".glare")) {
        const g = document.createElement("div");
        g.className = "glare";
        card.appendChild(g);
      }
      let raf = null;
      const max = parseFloat(card.dataset.tilt) || 9;

      function onMove(e) {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", px * 100 + "%");
        card.style.setProperty("--my", py * 100 + "%");
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          card.style.transform =
            "perspective(1100px) rotateX(" +
            (0.5 - py) * max * 2 +
            "deg) rotateY(" +
            (px - 0.5) * max * 2 +
            "deg) translateZ(14px)";
        });
      }
      card.addEventListener("pointermove", onMove);
      card.addEventListener("pointerleave", () => {
        card.style.transform = "";
      });
    });
  }

  /* ── 2d. Magnetic buttons ── */
  function initMagnetic() {
    if (REDUCED || window.matchMedia("(hover: none)").matches) return;
    document.querySelectorAll(".btn, .nav-cta").forEach((btn) => {
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform =
          "translate(" + dx * 0.14 + "px," + (dy * 0.2 - 2) + "px)";
      });
      btn.addEventListener("pointerleave", () => {
        btn.style.transform = "";
      });
    });
  }

  /* ── 2e. Cursor halo ── */
  function initCursorHalo() {
    if (REDUCED || window.matchMedia("(hover: none)").matches) return;
    const halo = document.createElement("div");
    halo.className = "cursor-halo";
    document.body.appendChild(halo);
    let x = innerWidth / 2,
      y = innerHeight / 2,
      tx = x,
      ty = y;
    window.addEventListener(
      "pointermove",
      (e) => {
        tx = e.clientX;
        ty = e.clientY;
        document.body.classList.add("has-halo");
      },
      { passive: true },
    );
    (function loop() {
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      halo.style.transform =
        "translate3d(" + (x - 170) + "px," + (y - 170) + "px,0)";
      requestAnimationFrame(loop);
    })();
  }

  /* ── 2f. Scroll progress rail ── */
  function initScrollRail() {
    const rail = document.createElement("div");
    rail.className = "scroll-rail";
    document.body.appendChild(rail);
    function upd() {
      const max = document.documentElement.scrollHeight - innerHeight;
      rail.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + "%";
    }
    window.addEventListener("scroll", upd, { passive: true });
    window.addEventListener("resize", upd, { passive: true });
    upd();
  }

  /* ── 2g. 3D device coverflow stage ── */
  function initStage() {
    const stage = document.querySelector("[data-stage]");
    if (!stage) return;
    const items = [...stage.querySelectorAll(".stage-item")];
    if (!items.length) return;
    const dotsWrap = document.querySelector("[data-stage-dots]");
    let index = 0;
    let timer = null;

    if (dotsWrap) {
      items.forEach((_, i) => {
        const d = document.createElement("span");
        d.className = "stage-dot";
        d.addEventListener("click", () => go(i, true));
        dotsWrap.appendChild(d);
      });
    }

    function layout() {
      const n = items.length;
      items.forEach((el, i) => {
        let off = i - index;
        if (off > n / 2) off -= n;
        if (off < -n / 2) off += n;
        const abs = Math.abs(off);
        const x = off * 210;
        const z = -abs * 260;
        const ry = off * -26;
        el.style.transform =
          "translateX(" +
          x +
          "px) translateZ(" +
          z +
          "px) rotateY(" +
          ry +
          "deg) scale(" +
          (1 - abs * 0.06) +
          ")";
        el.style.opacity = abs > 2 ? 0 : 1 - abs * 0.26;
        el.style.filter = "blur(" + Math.min(abs * 1.6, 5) + "px)";
        el.style.zIndex = String(50 - abs);
        el.style.pointerEvents = abs > 1 ? "none" : "auto";
        el.classList.toggle("is-front", off === 0);
      });
      if (dotsWrap) {
        [...dotsWrap.children].forEach((d, i) =>
          d.classList.toggle("on", i === index),
        );
      }
    }

    function go(i, manual) {
      index = (i + items.length) % items.length;
      layout();
      if (manual) restart();
    }
    function restart() {
      clearInterval(timer);
      if (!REDUCED) timer = setInterval(() => go(index + 1), 5200);
    }

    stage.querySelectorAll(".stage-item").forEach((el, i) => {
      el.addEventListener("click", () => {
        if (i === index) {
          const link = el.dataset.href;
          if (link) location.href = link;
        } else go(i, true);
      });
    });

    const prev = document.querySelector("[data-stage-prev]");
    const next = document.querySelector("[data-stage-next]");
    if (prev) prev.addEventListener("click", () => go(index - 1, true));
    if (next) next.addEventListener("click", () => go(index + 1, true));

    /* swipe */
    let sx = null;
    stage.addEventListener(
      "touchstart",
      (e) => {
        sx = e.touches[0].clientX;
      },
      { passive: true },
    );
    stage.addEventListener(
      "touchend",
      (e) => {
        if (sx == null) return;
        const dx = e.changedTouches[0].clientX - sx;
        if (Math.abs(dx) > 42) go(index + (dx < 0 ? 1 : -1), true);
        sx = null;
      },
      { passive: true },
    );

    layout();
    restart();
  }

  /* ── 2h. Depth parallax on marked elements ── */
  function initParallax() {
    if (REDUCED) return;
    const els = [...document.querySelectorAll("[data-depth]")];
    if (!els.length) return;
    let raf = null;
    function upd() {
      raf = null;
      const vh = innerHeight;
      els.forEach((el) => {
        const r = el.getBoundingClientRect();
        const center = r.top + r.height / 2 - vh / 2;
        const d = parseFloat(el.dataset.depth) || 0.06;
        el.style.transform = "translate3d(0," + -center * d + "px,0)";
      });
    }
    window.addEventListener(
      "scroll",
      () => {
        if (!raf) raf = requestAnimationFrame(upd);
      },
      { passive: true },
    );
    upd();
  }

  /* ── boot ── */
  function boot() {
    splitHeadline();
    initHeroGL();
    initReveal();
    initTilt();
    initMagnetic();
    initCursorHalo();
    initScrollRail();
    initStage();
    initParallax();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
