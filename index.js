/* ═══════════════════════════════════════
   CRYO MONGOLIA — script.js
   Warm Light Theme
═══════════════════════════════════════ */

/* ── NAV scroll ── */
window.addEventListener("scroll", () => {
  document.getElementById("navbar").classList.toggle("scrolled", scrollY > 50);
});

/* ── Counter animation ── */
(function initCounters() {
  const counterObs = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      document.querySelectorAll(".stat-num[data-target]").forEach((el) => {
        const target = +el.dataset.target;
        const unit = el.querySelector(".stat-unit")?.outerHTML || "";
        let cur = 0;
        const step = target / 55;
        const t = setInterval(() => {
          cur = Math.min(cur + step, target);
          el.innerHTML = Math.floor(cur) + unit;
          if (cur >= target) clearInterval(t);
        }, 18);
      });
      counterObs.disconnect();
    },
    { threshold: 0.25 },
  );

  const statsSection = document.querySelector(".stats");
  if (statsSection) counterObs.observe(statsSection);
})();

/* ── Treatments filter ── */
function filterTreatments(cat, btn) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".treatment-card").forEach((c) => {
    c.classList.toggle("active-card", cat === "all" || c.dataset.cat === cat);
  });
}

/* ── Mobile menu ── */
function toggleMenu() {
  const menu = document.getElementById("mobileMenu");
  const burger = document.getElementById("hamburger");
  const isOpen = menu.classList.toggle("open");
  document.body.style.overflow = isOpen ? "hidden" : "";
  if (burger) {
    const spans = burger.querySelectorAll("span");
    if (isOpen) {
      spans[0].style.transform = "rotate(45deg) translate(5px, 5px)";
      spans[1].style.opacity = "0";
      spans[2].style.transform = "rotate(-45deg) translate(5px, -5px)";
    } else {
      spans.forEach((s) => {
        s.style.transform = "";
        s.style.opacity = "";
      });
    }
  }
}

/* ════════════════════════════════════════
   BOOKING SYSTEM
════════════════════════════════════════ */

const TIMES = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
];
const WD = ["Ням", "Дав", "Мяг", "Лха", "Пүр", "Баа", "Бям"];

const bookedMap = {};
function getBooked(key) {
  if (!bookedMap[key]) {
    const arr = [];
    const n = 2 + Math.floor(Math.random() * 3);
    while (arr.length < n) {
      const t = TIMES[Math.floor(Math.random() * TIMES.length)];
      if (!arr.includes(t)) arr.push(t);
    }
    bookedMap[key] = arr;
  }
  return bookedMap[key];
}

let bk = { dateKey: "", time: "", bank: "", bankName: "" };
let dateOffset = 0;
const DATE_SHOW = 7;
let qrInterval = null;

function dateFromOffset(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n + 1);
  return d;
}
function fmtKey(d) {
  return d.toISOString().split("T")[0];
}

/* Build date tabs */
function buildDateTabs() {
  const tabs = document.getElementById("dateTabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  for (let i = 0; i < DATE_SHOW; i++) {
    const d = dateFromOffset(dateOffset + i);
    const key = fmtKey(d);
    const tab = document.createElement("div");
    tab.className = "date-tab" + (key === bk.dateKey ? " selected" : "");
    tab.innerHTML =
      `<div class="dt-wd">${WD[d.getDay()]}</div>` +
      `<div class="dt-d">${d.getDate()}</div>` +
      `<div class="dt-m">${d.getMonth() + 1}-р</div>`;
    tab.onclick = () => pickDate(key, tab);
    tabs.appendChild(tab);
  }
  const prevBtn = document.getElementById("datePrevBtn");
  if (prevBtn) prevBtn.disabled = dateOffset === 0;
}

function shiftDates(dir) {
  dateOffset = Math.max(0, dateOffset + dir * DATE_SHOW);
  buildDateTabs();
}

function pickDate(key, el) {
  bk.dateKey = key;
  bk.time = "";
  document
    .querySelectorAll(".date-tab")
    .forEach((t) => t.classList.remove("selected"));
  el.classList.add("selected");
  buildTimeGrid();
}

/* Build time grid */
function buildTimeGrid() {
  const grid = document.getElementById("timeGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const booked = bk.dateKey ? getBooked(bk.dateKey) : [];
  TIMES.forEach((t) => {
    const s = document.createElement("div");
    const b = booked.includes(t);
    s.className =
      "time-slot" + (b ? " booked" : "") + (t === bk.time ? " selected" : "");
    s.textContent = t;
    if (!b) s.onclick = () => pickTime(t, s);
    grid.appendChild(s);
  });
}

function pickTime(t, el) {
  bk.time = t;
  document
    .querySelectorAll(".time-slot")
    .forEach((s) => s.classList.remove("selected"));
  el.classList.add("selected");
}

/* Step navigation */
function setStepDots(active) {
  [1, 2, 3].forEach((i) => {
    const dot = document.getElementById("dot" + i);
    const line = document.getElementById("line" + i);
    if (!dot) return;
    dot.className =
      "step-dot" + (i < active ? " done" : i === active ? " active" : "");
    if (line) line.className = "step-line" + (i < active ? " done" : "");
  });
}

function showPanel(id) {
  ["step1", "step2", "step2b", "step3"].forEach((p) => {
    const el = document.getElementById(p);
    if (el) el.classList.remove("active");
  });
  const target = document.getElementById(id);
  if (target) target.classList.add("active");
}

function goStepNum(n) {
  setStepDots(n);
  showPanel("step" + n);
}

/* Validate & go to step 2 */
function goStep2() {
  const name = document.getElementById("b_name")?.value.trim();
  const phone = document.getElementById("b_phone")?.value.trim();
  if (!name) {
    shakeInput("b_name");
    return;
  }
  if (!phone) {
    shakeInput("b_phone");
    return;
  }
  if (!bk.dateKey) {
    showToast("Огноо сонгоно уу");
    return;
  }
  if (!bk.time) {
    showToast("Цаг сонгоно уу");
    return;
  }

  const d = new Date(bk.dateKey);
  const dl = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${WD[d.getDay()]})`;
  setText("sum_date", dl);
  setText("sum_time", bk.time);
  setStepDots(2);
  showPanel("step2");
}

function selectBank(el, id, name) {
  document
    .querySelectorAll(".bank-btn")
    .forEach((b) => b.classList.remove("selected"));
  el.classList.add("selected");
  bk.bank = id;
  bk.bankName = name;
}

/* Show QR */
function showQR() {
  if (!bk.bank) {
    showToast("Банкаа сонгоно уу");
    return;
  }

  // Mark slot booked immediately
  if (!bookedMap[bk.dateKey]) bookedMap[bk.dateKey] = [];
  if (!bookedMap[bk.dateKey].includes(bk.time))
    bookedMap[bk.dateKey].push(bk.time);

  setText("qrBankName", bk.bankName.toUpperCase() + " — QPAY");
  setStepDots(2);
  showPanel("step2b");
  startTimer();

  // Simulate payment after 6s
  setTimeout(() => {
    if (document.getElementById("step2b")?.classList.contains("active"))
      doConfirm();
  }, 6000);
}

function startTimer() {
  if (qrInterval) clearInterval(qrInterval);
  let secs = 599;
  const el = document.getElementById("qrTimer");
  if (el) el.textContent = "09:59";
  qrInterval = setInterval(() => {
    if (--secs <= 0) {
      clearInterval(qrInterval);
      if (el) el.textContent = "00:00";
      return;
    }
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function doConfirm() {
  if (qrInterval) clearInterval(qrInterval);
  const ref = "CRYO-" + (1000 + Math.floor(Math.random() * 9000));
  const name = document.getElementById("b_name")?.value || "";
  const phone = document.getElementById("b_phone")?.value || "";
  const d = new Date(bk.dateKey);
  const dl = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${WD[d.getDay()]})`;

  /* push the booking into the admin dashboard (no-op without Supabase) */
  if (window.cryoData) {
    window.cryoData
      .saveBooking({
        ref: ref,
        customer_name: name || "—",
        phone: phone,
        booked_date: bk.dateKey || null,
        booked_time: bk.time || null,
        amount: 100000,
        deposit: 100000,
        bank: bk.bankName || null,
        status: "pending",
      })
      .then(function (r) {
        if (r && r.error) console.warn("[cryo] booking not saved:", r.error.message);
      });
  }

  setText("bookingRef", ref);
  const det = document.getElementById("confirmDetails");
  if (det) {
    det.innerHTML =
      `<strong style="color:var(--text-primary)">${name}</strong> · ${phone}<br>` +
      `📅 ${dl} · ⏰ ${bk.time}<br>` +
      `<span style="color:var(--accent);font-size:12px;">✓ ₮100,000 — ${bk.bankName}</span>`;
  }
  setStepDots(3);
  showPanel("step3");
}

/* Modal open / close */
function openModal() {
  bk = { dateKey: "", time: "", bank: "", bankName: "" };
  dateOffset = 0;
  buildDateTabs();
  buildTimeGrid();
  document
    .querySelectorAll(".bank-btn")
    .forEach((b) => b.classList.remove("selected"));
  const nameEl = document.getElementById("b_name");
  const phoneEl = document.getElementById("b_phone");
  if (nameEl) nameEl.value = "";
  if (phoneEl) phoneEl.value = "";
  setStepDots(1);
  showPanel("step1");
  document.getElementById("modalOverlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  if (qrInterval) clearInterval(qrInterval);
  document.getElementById("modalOverlay").classList.remove("open");
  document.body.style.overflow = "";
}

function closeModalOnBg(e) {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
}

/* ── Helpers ── */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function shakeInput(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = "#ff6b6b";
  el.style.animation = "shake .35s ease";
  setTimeout(() => {
    el.style.borderColor = "";
    el.style.animation = "";
  }, 600);
  el.focus();

  if (!document.getElementById("shake-style")) {
    const s = document.createElement("style");
    s.id = "shake-style";
    s.textContent = `@keyframes shake {
      0%,100%{transform:translateX(0)}
      20%{transform:translateX(-5px)}
      40%{transform:translateX(5px)}
      60%{transform:translateX(-4px)}
      80%{transform:translateX(4px)}
    }`;
    document.head.appendChild(s);
  }
}

function showToast(msg) {
  const existing = document.getElementById("cryo-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "cryo-toast";
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 500);
  }, 2800);
}
