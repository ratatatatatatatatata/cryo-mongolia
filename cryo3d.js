/* ══════════════════════════════════════════════════════════════
   °CRYO MONGOLIA — cryo3d.js
   1) WebGL raymarched ice-core hero (no libraries, ~0 deps)
   2) CSS-3D interaction layer: tilt cards, device coverflow,
      scroll reveal, magnetic buttons, cursor halo, parallax
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ════════════════════════════════════════════════════════════
     1. WEBGL — VOLUMETRIC ICE CORE
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
    for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.04; a *= 0.5; }
    return s;
  }

  /* icosahedral gem — sharp natural ice facets */
  float sdIcosa(vec3 p, float r){
    const float G = 1.6180339;
    vec3 n = normalize(vec3(G, 1.0, 0.0));
    p = abs(p);
    float d = dot(p, n);
    d = max(d, dot(p, n.yzx));
    d = max(d, dot(p, n.zxy));
    d = max(d, dot(p, vec3(0.5773503)));
    return d - r;
  }

  vec3 twist(vec3 p){
    float t = uTime * 0.13;
    p.xz *= rot(t);
    p.xy *= rot(t * 0.62);
    return p;
  }

  /* main crystal field */
  float mapCrystal(vec3 p){
    vec3 q = twist(p);
    float gem  = sdIcosa(q, 0.94);
    vec3 q2 = q;
    q2.xy *= rot(0.92);
    q2.yz *= rot(0.61);
    float oct = (abs(q2.x) + abs(q2.y) + abs(q2.z)) * 0.5773503 - 1.00;
    gem = max(gem, oct);
    float ball = length(q) - 1.07;
    float d = mix(gem, ball, 0.10);
    /* frost relief on the surface */
    d -= (fbm(q * 4.2 + vec3(0.0, uTime * 0.10, 0.0)) - 0.5) * 0.045;
    /* slow breathing */
    d -= sin(uTime * 0.7) * 0.012;
    return d * 0.70;
  }

  vec3 normalAt(vec3 p){
    vec2 e = vec2(0.0022, 0.0);
    return normalize(vec3(
      mapCrystal(p + e.xyy) - mapCrystal(p - e.xyy),
      mapCrystal(p + e.yxy) - mapCrystal(p - e.yxy),
      mapCrystal(p + e.yyx) - mapCrystal(p - e.yyx)));
  }

  /* procedural cold environment for reflections/refraction */
  vec3 envColor(vec3 rd){
    float up = rd.y * 0.5 + 0.5;
    vec3 sky  = mix(vec3(0.016, 0.035, 0.070), vec3(0.10, 0.34, 0.58), pow(up, 1.4));
    /* two cold key lights */
    float k1 = pow(max(dot(rd, normalize(vec3(-0.55, 0.62, 0.55))), 0.0), 22.0);
    float k2 = pow(max(dot(rd, normalize(vec3( 0.80, 0.15, 0.55))), 0.0), 10.0);
    sky += vec3(0.80, 0.94, 1.00) * k1 * 1.5;
    sky += vec3(0.16, 0.52, 0.90) * k2 * 0.7;
    /* faint ice dust */
    float d = fbm(rd * 9.0 + vec3(uTime * 0.03));
    sky += vec3(0.25, 0.55, 0.85) * pow(d, 4.0) * 0.35;
    return sky;
  }

  /* ── cold mist falling around the core ── */
  float mistDensity(vec3 p){
    vec3 q = p;
    q.y += uTime * 0.16;                 /* cold air sinks */
    q.xz *= rot(uTime * 0.035);
    float n = fbm(q * 0.85);
    float shell = smoothstep(2.6, 0.75, length(p.xz * vec2(1.0, 1.0)));
    float band  = smoothstep(1.9, -1.4, p.y);
    return max(0.0, (n - 0.46)) * shell * band;
  }

  void main(){
    float wide = smoothstep(1.05, 1.65, uRes.x / uRes.y);
    float cx = mix(0.50, 0.735, wide);   /* portrait: centred · landscape: right of the copy */
    float cy = mix(0.40, 0.52, wide);    /* portrait: sits below the headline */
    vec2 uv = (gl_FragCoord.xy - vec2(uRes.x * cx, uRes.y * cy)) / uRes.y;

    /* camera */
    vec3 ro = vec3(0.0, 0.10, 6.90);
    vec3 target = vec3(0.0, 0.0, 0.0);
    /* mouse + scroll drive a gentle orbit */
    float ax = uMouse.x * 0.42;
    float ay = uMouse.y * 0.26 - uScroll * 0.30;
    ro.yz *= rot(-ay);
    ro.xz *= rot(ax);

    vec3 fwd = normalize(target - ro);
    vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up  = cross(fwd, rgt);
    vec3 rd  = normalize(uv.x * rgt + uv.y * up + 1.50 * fwd);

    vec3 bg  = envColor(rd) * 0.55;
    vec3 col = bg;

    /* ── raymarch the crystal ── */
    float t = 0.0, dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++){
      vec3 p = ro + rd * t;
      dist = mapCrystal(p);
      if (dist < 0.0016){ hit = true; break; }
      if (t > 12.0) break;
      t += dist;
    }

    if (hit){
      vec3 p = ro + rd * t;
      vec3 n = normalAt(p);

      float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.2);

      /* ── enter the ice ── */
      vec3 rr  = refract(rd, n, 1.0 / 1.31);
      vec3 rfl = reflect(rd, n);
      vec3 mirror = envColor(rfl);

      /* march the inverted field until the ray exits the far surface */
      vec3 pin = p - n * 0.006;
      float ti = 0.0;
      for (int j = 0; j < 26; j++){
        float dd = -mapCrystal(pin + rr * ti);
        if (dd < 0.0012) break;
        ti += max(dd, 0.012);
      }
      vec3 pex  = pin + rr * ti;
      vec3 nex  = -normalAt(pex);
      vec3 rout = refract(rr, nex, 1.31);
      if (dot(rout, rout) < 0.0001) rout = reflect(rr, nex);   /* total internal reflection */

      vec3 trans = envColor(rout);

      /* Beer-Lambert: thick ice goes deep cyan */
      trans = trans * 2.05 * exp(-ti * vec3(0.62, 0.24, 0.12));

      /* frozen veins scatter light inside the body */
      float veins = fbm(twist(mix(pin, pex, 0.5)) * 5.6 + vec3(0.0, uTime * 0.06, 0.0));
      trans += vec3(0.30, 0.66, 1.0) * pow(veins, 3.0) * 0.9 * clamp(ti, 0.0, 1.4);

      /* a little of the raw backdrop bleeds through thin edges */
      trans = mix(trans, bg * 1.6, clamp(0.34 - ti * 0.18, 0.0, 0.34));

      col = mix(trans, mirror, clamp(fres * 1.2, 0.0, 0.95));

      /* specular highlights */
      vec3 L1 = normalize(vec3(-0.55, 0.72, 0.62));
      vec3 L2 = normalize(vec3( 0.85, 0.22, 0.42));
      col += vec3(1.0) * pow(max(dot(reflect(-L1, n), -rd), 0.0), 140.0) * 3.4;
      col += vec3(0.70, 0.90, 1.0) * pow(max(dot(reflect(-L2, n), -rd), 0.0), 55.0) * 1.5;

      /* rim frost + razor edge highlight */
      col += vec3(0.62, 0.90, 1.0) * fres * 0.75;
      col += vec3(1.0, 1.0, 1.0) * pow(fres, 7.0) * 0.85;

      /* faint core bloom */
      col += vec3(0.08, 0.30, 0.55) * (1.0 - smoothstep(0.0, 1.5, length(p))) * 0.35;
    }

    /* ── volumetric mist (marched in front of / around the core) ── */
    float fogAcc = 0.0;
    float tm = 2.60;
    for (int i = 0; i < 26; i++){
      vec3 p = ro + rd * tm;
      if (hit && tm > t) break;
      fogAcc += mistDensity(p) * 0.105;
      tm += 0.235;
    }
    fogAcc = clamp(fogAcc, 0.0, 1.0);
    vec3 mistCol = mix(vec3(0.16, 0.34, 0.52), vec3(0.72, 0.90, 1.0), 0.35);
    col = mix(col, mistCol, fogAcc * 0.85);

    /* halo bloom around the core */
    float halo = 1.0 - smoothstep(0.0, 1.25, length(uv * vec2(1.0, 1.15)));
    col += vec3(0.12, 0.44, 0.80) * pow(max(halo, 0.0), 2.2) * 0.55;

    /* drifting ice sparkles */
    vec2 sp = uv * 8.0;
    sp.y += uTime * 0.12;
    vec2 cell = floor(sp);
    float sh = hash13(vec3(cell, 1.0));
    if (sh > 0.965){
      vec2 f = fract(sp) - 0.5;
      float tw = 0.55 + 0.45 * sin(uTime * 2.2 + sh * 40.0);
      col += vec3(0.75, 0.92, 1.0) * smoothstep(0.10, 0.0, length(f)) * tw * 0.8;
    }

    /* grade: filmic-ish + cold lift */
    col = max(col, 0.0);
    col = col / (col + 0.72);
    col = pow(col, vec3(0.85, 0.92, 0.98));
    col *= 1.0 - 0.32 * length(uv) * 0.55;

    /* fade the whole render out as the hero scrolls away */
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
