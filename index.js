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
  burger?.setAttribute("aria-expanded", String(isOpen));
  burger?.setAttribute("aria-label", isOpen ? "Цэс хаах" : "Цэс нээх");
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

const SLOT_STEP_MINUTES = 30;
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 21 * 60;
const WD = ["Ням", "Дав", "Мяг", "Лха", "Пүр", "Баа", "Бям"];

let bk = { dateKey: "", time: "", bank: "", bankName: "", service: null, services: [], blocks: [], selections: [], packageBooking: false };
let dateOffset = 0;
const DATE_SHOW = 7;
let qrInterval = null;
let availabilityUnsubscribe = null;

function dateFromOffset(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n + 1);
  return d;
}
function fmtKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function slotIso(dateKey, time) {
  return `${dateKey}T${time}:00+08:00`;
}
function minutesLabel(n) {
  return `${n} минут · цагийн сонголт 30 минутын зайтай`;
}
function activeService() {
  return bk.services.find((s) => Number(s.id) === Number(bk.service?.id)) || bk.service;
}

async function loadBookingSetup() {
  if (!window.cryoData?.ready) return;
  const res = await window.cryoData.getBookableServices();
  if (res?.error) {
    showToast("Үйлчилгээний мэдээлэл татаж чадсангүй");
    return;
  }
  bk.services = res.data || [];
  const select = document.getElementById("b_service");
  if (!select) return;
  select.innerHTML = '<option value="">Төхөөрөмж сонгоно уу</option>';
  bk.services.forEach((s) => {
    const option = document.createElement("option");
    option.value = String(s.id);
    option.textContent = `${s.name} · ${s.duration_minutes} мин`;
    select.appendChild(option);
  });
  if (bk.services.length === 1) {
    select.value = String(bk.services[0].id);
    await pickService(select.value);
  }
}

async function pickService(id) {
  bk.service = bk.services.find((s) => Number(s.id) === Number(id)) || null;
  bk.time = "";
  const hint = document.getElementById("bookingDurationHint");
  if (hint) hint.textContent = bk.service ? minutesLabel(bk.service.duration_minutes) : "Эхлээд төхөөрөмжөө сонгоно уу";
  await refreshAvailability();
}

async function refreshAvailability() {
  bk.blocks = [];
  if (bk.service && bk.dateKey && window.cryoData?.ready) {
    const res = await window.cryoData.getBookingBlocks(bk.service.id, bk.dateKey);
    if (!res?.error) bk.blocks = res.data || [];
  }
  buildTimeGrid();
}

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

async function pickDate(key, el) {
  bk.dateKey = key;
  bk.time = "";
  document.querySelectorAll(".date-tab").forEach((t) => t.classList.remove("selected"));
  el.classList.add("selected");
  await refreshAvailability();
}

function isUnavailable(start, finishWithBuffer) {
  const serviceId = Number(activeService()?.id || 0);
  const remoteBusy = bk.blocks.some((block) => {
    const occupiedStart = new Date(block.starts_at).getTime();
    const occupiedEnd = new Date(block.blocked_until || block.ends_at).getTime();
    return start < occupiedEnd && finishWithBuffer > occupiedStart;
  });
  const localBusy = bk.selections.some((item) => {
    if (Number(item.service.id) !== serviceId) return false;
    const occupiedStart = new Date(slotIso(item.dateKey, item.time)).getTime();
    const occupiedEnd = occupiedStart + ((Number(item.service.duration_minutes) || 30) + 2) * 60000;
    return start < occupiedEnd && finishWithBuffer > occupiedStart;
  });
  return remoteBusy || localBusy;
}

function buildTimeGrid() {
  const grid = document.getElementById("timeGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const service = activeService();
  if (!service || !bk.dateKey) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:18px">Төхөөрөмж болон огноогоо сонгоно уу.</div>';
    return;
  }
  const duration = Number(service.duration_minutes) || 30;
  for (let minute = OPEN_MINUTES; minute + duration <= CLOSE_MINUTES; minute += SLOT_STEP_MINUTES) {
    const hh = String(Math.floor(minute / 60)).padStart(2, "0");
    const mm = String(minute % 60).padStart(2, "0");
    const time = `${hh}:${mm}`;
    const start = new Date(slotIso(bk.dateKey, time)).getTime();
    const finishWithBuffer = start + (duration + 2) * 60000;
    const busy = isUnavailable(start, finishWithBuffer);
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "time-slot" + (busy ? " booked" : "") + (time === bk.time ? " selected" : "");
    slot.textContent = time;
    slot.disabled = busy;
    slot.title = busy ? "Энэ төхөөрөмж тухайн хугацаанд захиалгатай" : minutesLabel(duration);
    if (!busy) slot.onclick = () => pickTime(time, slot);
    grid.appendChild(slot);
  }
}

function pickTime(time, el) {
  bk.time = time;
  document.querySelectorAll(".time-slot").forEach((s) => s.classList.remove("selected"));
  el.classList.add("selected");
}

function togglePackageBooking(checked) {
  bk.packageBooking = !!checked;
  const badge = document.getElementById("bookingDepositBadge");
  if (badge) badge.style.display = checked ? "none" : "flex";
  renderBookingSelections();
}

function addBookingSelection() {
  const service = activeService();
  if (!service) return showToast("Төхөөрөмж сонгоно уу");
  if (!bk.dateKey) return showToast("Огноо сонгоно уу");
  if (!bk.time) return showToast("Цаг сонгоно уу");
  const duplicate = bk.selections.some((item) => Number(item.service.id) === Number(service.id) && item.dateKey === bk.dateKey && item.time === bk.time);
  if (duplicate) return showToast("Энэ үйлчилгээ, цаг аль хэдийн нэмэгдсэн байна");
  bk.selections.push({ service: { ...service }, dateKey: bk.dateKey, time: bk.time });
  bk.time = "";
  renderBookingSelections();
  buildTimeGrid();
}

function removeBookingSelection(index) {
  bk.selections.splice(index, 1);
  renderBookingSelections();
  buildTimeGrid();
}

function renderBookingSelections() {
  const host = document.getElementById("bookingSelections");
  if (!host) return;
  if (!bk.selections.length) {
    host.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:10px">Одоогоор үйлчилгээ нэмээгүй.</div>';
    return;
  }
  host.innerHTML = bk.selections.map((item, index) => {
    const d = new Date(item.dateKey + "T12:00:00");
    const when = `${d.getMonth() + 1}/${d.getDate()} · ${item.time}`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid rgba(110,196,255,.2);border-radius:10px;background:rgba(255,255,255,.025)"><div><b style="display:block;font-size:12.5px;color:var(--text-primary)">${item.service.name}</b><span style="font-size:11.5px;color:var(--text-muted)">${when}</span></div><button type="button" class="btn-ghost" style="margin:0" onclick="removeBookingSelection(${index})">Хасах</button></div>`;
  }).join("");
}

function setStepDots(active) {
  [1, 2, 3].forEach((i) => {
    const dot = document.getElementById("dot" + i);
    const line = document.getElementById("line" + i);
    if (!dot) return;
    dot.className = "step-dot" + (i < active ? " done" : i === active ? " active" : "");
    if (line) line.className = "step-line" + (i < active ? " done" : "");
  });
}
function showPanel(id) {
  ["step1", "step2", "step2b", "step3"].forEach((p) => document.getElementById(p)?.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}
function goStepNum(n) {
  setStepDots(n);
  showPanel("step" + n);
}

function goStep2() {
  const name = document.getElementById("b_name")?.value.trim();
  const phone = document.getElementById("b_phone")?.value.trim();
  if (!name) return shakeInput("b_name");
  if (!phone) return shakeInput("b_phone");
  if (bk.service && bk.dateKey && bk.time) addBookingSelection();
  if (!bk.selections.length) return showToast("Дор хаяж нэг үйлчилгээ, цаг нэмнэ үү");
  setText("sum_service", `${bk.selections.length} үйлчилгээ`);
  setText("sum_date", bk.selections.map((item) => `${item.dateKey.slice(5)} ${item.time}`).join(" · "));
  setText("sum_time", `${bk.selections.reduce((sum, item) => sum + (Number(item.service.duration_minutes) || 30), 0)} минут`);
  setText("sum_deposit", bk.packageBooking ? "Багцын эрхээр" : "₮100,000 (нийт нэг удаа)");
  const payButton = document.getElementById("bookingPayButton");
  if (payButton) payButton.textContent = bk.packageBooking ? "Захиалга баталгаажуулах →" : "QR код авах →";
  setStepDots(2);
  showPanel("step2");
}

function selectBank(el, id, name) {
  document.querySelectorAll(".bank-btn").forEach((b) => b.classList.remove("selected"));
  el.classList.add("selected");
  bk.bank = id;
  bk.bankName = name;
}

function showQR() {
  if (bk.packageBooking) return doConfirm();
  if (!bk.bank) return showToast("Банкаа сонгоно уу");
  setText("qrBankName", bk.bankName.toUpperCase() + " — QPAY");
  setStepDots(2);
  showPanel("step2b");
  startTimer();
  setTimeout(() => {
    if (document.getElementById("step2b")?.classList.contains("active")) doConfirm();
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
    if (el) el.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  }, 1000);
}

async function doConfirm() {
  if (qrInterval) clearInterval(qrInterval);
  if (!bk.selections.length) return goStepNum(1);
  const ref = "CRYO-" + Date.now().toString(36).toUpperCase();
  const name = document.getElementById("b_name")?.value || "";
  const phone = document.getElementById("b_phone")?.value || "";
  const userId = window.cryoAuth?.user?.id || null;
  if (!window.cryoData?.ready) {
    showToast("Захиалгын системтэй холбогдож чадсангүй");
    return goStepNum(1);
  }
  const rows = bk.selections.map((item, index) => ({
    ref: index ? `${ref}-${index + 1}` : ref,
    booking_group: ref,
    booking_kind: bk.packageBooking ? "package" : "standard",
    customer_name: name || "—",
    phone,
    service_id: item.service.id,
    starts_at: slotIso(item.dateKey, item.time),
    amount: bk.packageBooking ? 0 : (index === 0 ? 100000 : 0),
    deposit: bk.packageBooking ? 0 : (index === 0 ? 100000 : 0),
    bank: bk.packageBooking ? null : (bk.bankName || null),
    package: bk.packageBooking ? "Багцын эрхээр — админ шалгана" : null,
    note: `Нэгдсэн захиалга ${index + 1}/${bk.selections.length}`,
    status: "pending",
    user_id: userId,
  }));
  const result = await window.cryoData.saveBookings(rows);
  if (result?.error) {
    const conflict = result.error.code === "23P01" || /overlap|conflict/i.test(result.error.message || "");
    showToast(conflict ? "Энэ цаг дөнгөж захиалагдлаа. Өөр цаг сонгоно уу." : "Захиалга хадгалахад алдаа гарлаа.");
    goStepNum(1);
    await refreshAvailability();
    return;
  }
  setText("bookingRef", ref);
  const det = document.getElementById("confirmDetails");
  if (det) det.innerHTML =
    `<strong style="color:var(--text-primary)">${name}</strong> · ${phone}<br>` +
    bk.selections.map((item) => `❄ ${item.service.name} · ${item.dateKey} · ⏰ ${item.time}`).join("<br>") + "<br>" +
    `<span style="color:var(--accent);font-size:12px;">✓ ${bk.packageBooking ? "Багцын эрхээр — админ үлдэгдлийг шалгана" : `₮100,000 — ${bk.bankName}`}</span>`;
  setStepDots(3);
  showPanel("step3");
}

function openModal() {
  if (window.cryoAuth) return window.cryoAuth.require(openBookingModal);
  openBookingModal();
}

async function openBookingModal() {
  bk = { dateKey: "", time: "", bank: "", bankName: "", service: null, services: [], blocks: [], selections: [], packageBooking: false };
  dateOffset = 0;
  buildDateTabs();
  buildTimeGrid();
  document.querySelectorAll(".bank-btn").forEach((b) => b.classList.remove("selected"));
  const packageToggle = document.getElementById("b_package");
  if (packageToggle) packageToggle.checked = false;
  togglePackageBooking(false);
  renderBookingSelections();
  const prof = window.cryoAuth?.profile;
  const nameEl = document.getElementById("b_name");
  const phoneEl = document.getElementById("b_phone");
  if (nameEl) nameEl.value = prof?.full_name || "";
  if (phoneEl) phoneEl.value = "";
  setStepDots(1);
  showPanel("step1");
  const overlay = document.getElementById("modalOverlay");
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  await loadBookingSetup();
  if (availabilityUnsubscribe) availabilityUnsubscribe();
  if (window.cryoData?.subscribeAvailability) {
    availabilityUnsubscribe = window.cryoData.subscribeAvailability(() => refreshAvailability());
  }
  setTimeout(() => document.getElementById("b_name")?.focus(), 80);
}

function closeModal() {
  if (qrInterval) clearInterval(qrInterval);
  if (availabilityUnsubscribe) availabilityUnsubscribe();
  availabilityUnsubscribe = null;
  const overlay = document.getElementById("modalOverlay");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
function closeModalOnBg(e) {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.getElementById("modalOverlay")?.classList.contains("open")) closeModal();
});

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function shakeInput(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = "#ff6b6b";
  el.style.animation = "shake .35s ease";
  setTimeout(() => { el.style.borderColor = ""; el.style.animation = ""; }, 600);
  el.focus();
  if (!document.getElementById("shake-style")) {
    const s = document.createElement("style");
    s.id = "shake-style";
    s.textContent = "@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}40%{transform:translateX(5px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}";
    document.head.appendChild(s);
  }
}
function showToast(msg) {
  document.getElementById("cryo-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "cryo-toast";
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 500); }, 2800);
}
