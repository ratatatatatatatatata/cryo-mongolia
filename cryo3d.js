/* ══════════════════════════════════════════════════════════════
   °CRYO MONGOLIA — cryo3d.js
   Interaction layer: tilt cards, device coverflow, scroll reveal,
   magnetic buttons, cursor halo, parallax
   ══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ════════════════════════════════════════════════════════════
     CSS-3D INTERACTION LAYER
     ════════════════════════════════════════════════════════════ */

  /* ── a. Hero headline: split into rising words ── */
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

  /* ── b. Scroll reveal (+ stagger) ── */
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

  /* ── c. 3D tilt + glare on cards ── */
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

  /* ── d. Magnetic buttons ── */
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

  /* ── e. Cursor halo ── */
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

  /* ── f. Scroll progress rail ── */
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

  /* ── g. 3D device coverflow stage ── */
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

  /* ── h. Depth parallax on marked elements ── */
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
