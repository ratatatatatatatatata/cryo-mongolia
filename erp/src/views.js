import { can, normalizeRole, ROLE_LABELS, visibleNavigation } from "./permissions.js";
import {
  businessDate,
  escapeHtml,
  formatDate,
  formatMoney,
  fullName,
  initials,
  maskPhone,
  remainingCount,
} from "./utils.js";

function icon(name) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    staff: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0M19 8h4M21 6v4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="m15 18-6-6 6-6"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    package: '<path d="m21 8-9 5-9-5M3 8l9-5 9 5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    money: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M12 10v5M9.5 12.5h5M6 10h.01M18 15h.01"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.grid}</svg>`;
}

function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] ?? ROLE_LABELS.staff;
}

export function setupView(config, adapterError = null) {
  const invalid = config.status === "invalid";
  const title = invalid ? "Тохиргоо аюулгүй биш байна" : "Системийн холболт бэлэн биш байна";
  const detail = adapterError?.message ?? config.message;

  return `
    <main id="main-content" class="setup-page" tabindex="-1">
      <section class="setup-card" aria-labelledby="setup-title">
        <div class="brand-lockup"><span class="brand-symbol">°</span><span>CRYO MONGOLIA</span></div>
        <span class="status-orb ${invalid ? "status-orb--danger" : ""}" aria-hidden="true"></span>
        <p class="eyebrow">Ажилтны ERP</p>
        <h1 id="setup-title">${escapeHtml(title)}</h1>
        <p>${escapeHtml(detail ?? "Runtime config болон backend adapter-ыг холбоно уу.")}</p>
        <div class="setup-note">
          <strong>Аюулгүй эхлүүлэх нөхцөл</strong>
          <p><code>window.CRYO_ERP_CONFIG</code> нь project URL, browser publishable key агуулна. Secret эсвэл өндөр эрхтэй server key-г browser-д оруулахгүй.</p>
        </div>
        ${
          config.canUseLocalDemo
            ? `<button class="button button--primary" type="button" data-action="enable-demo">Local demo нээх</button>
               <p class="microcopy">Demo өгөгдөл зөвхөн энэ localhost tab-д, санах ойд ажиллана.</p>`
            : `<p class="secure-lock">🔒 Нийтийн домэйн дээр demo горим хаалттай.</p>`
        }
      </section>
    </main>`;
}

export function frameBlockedView() {
  return `<main id="main-content" class="setup-page" tabindex="-1">
    <section class="setup-card" role="alert" aria-labelledby="frame-blocked-title">
      <div class="brand-lockup"><span class="brand-symbol">°</span><span>CRYO MONGOLIA</span></div>
      <div class="security-illustration">${icon("shield")}</div>
      <h1 id="frame-blocked-title">Системийг frame дотор нээхийг хориглосон</h1>
      <p>Аюулгүй байдлын үүднээс ажилтны системийг шинэ tab-д шууд нээнэ үү.</p>
    </section>
  </main>`;
}

export function loginView({ localDemo = false, error = "" } = {}) {
  return `
    <main id="main-content" class="login-page" tabindex="-1">
      <section class="login-visual" aria-label="CRYO Mongolia ажилтны систем">
        <div class="brand-lockup brand-lockup--light"><span class="brand-symbol">°</span><span>CRYO MONGOLIA</span></div>
        <div class="login-copy">
          <p class="eyebrow">Ажилтны орчин</p>
          <h1>Үйлчилгээ бүрийг<br />нэг дороос.</h1>
          <p>Үйлчлүүлэгч, багцын эрх, үйлчилгээний түүхийг найдвартай удирдана.</p>
        </div>
      </section>
      <section class="login-panel" aria-labelledby="login-title">
        <form class="login-form" data-form="login" novalidate>
          <div>
            <p class="eyebrow">Тавтай морил</p>
            <h2 id="login-title">Нэвтрэх</h2>
            <p class="muted">Зөвхөн эрх бүхий ажилтан нэвтэрнэ.</p>
          </div>
          ${error ? `<div class="alert alert--error" role="alert">${escapeHtml(error)}</div>` : ""}
          ${
            localDemo
              ? `<div class="alert alert--info" role="status"><strong>Local demo</strong><br />owner@example.invalid эсвэл staff@example.invalid; дурын 8+ тэмдэгт нууц үг.</div>`
              : ""
          }
          <label class="field">
            <span>Имэйл</span>
            <input name="email" type="email" autocomplete="username" inputmode="email" required />
          </label>
          <label class="field">
            <span>Нууц үг</span>
            <input name="password" type="password" autocomplete="current-password" minlength="8" required />
          </label>
          <button class="button button--primary button--wide" type="submit">Нэвтрэх</button>
          <p class="privacy-note">Нууц үгээ бусадтай хуваалцахгүй. Нэвтрэх асуудал гарвал админтай холбогдоно уу.</p>
        </form>
      </section>
    </main>`;
}

export function inviteCompletionView(error = "") {
  return `<main id="main-content" class="setup-page" tabindex="-1">
    <section class="setup-card" aria-labelledby="invite-title">
      <div class="brand-lockup"><span class="brand-symbol">°</span><span>CRYO MONGOLIA</span></div>
      <div class="security-illustration">${icon("shield")}</div>
      <p class="eyebrow">Ажилтны урилга</p><h1 id="invite-title">Нууц үгээ тохируулах</h1>
      <p>Урилгаа дуусгахын тулд зөвхөн энэ системд ашиглах хүчтэй нууц үг үүсгэнэ үү.</p>
      <form class="login-form" data-form="invite-complete">
        ${error ? `<div class="alert alert--error" role="alert">${escapeHtml(error)}</div>` : ""}
        <label class="field"><span>Шинэ нууц үг *</span><input name="password" type="password" minlength="12" autocomplete="new-password" required /></label>
        <label class="field"><span>Нууц үг давтах *</span><input name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required /></label>
        <p class="microcopy">12+ тэмдэгт; урт, давтагдашгүй хэллэг ашиглахыг зөвлөж байна.</p>
        <div class="dialog-actions"><button class="button button--primary" type="submit">Урилга дуусгах</button></div>
      </form>
    </section>
  </main>`;
}

export function pendingActivationView(message = "") {
  return `<main id="main-content" class="setup-page" tabindex="-1">
    <section class="setup-card" aria-labelledby="pending-title">
      <div class="brand-lockup"><span class="brand-symbol">°</span><span>CRYO MONGOLIA</span></div>
      <span class="status-orb" aria-hidden="true"></span>
      <p class="eyebrow">Эрх идэвхжүүлэх</p><h1 id="pending-title">Админы баталгаажуулалт хүлээгдэж байна</h1>
      <p>${escapeHtml(message || "Таны нууц үг тохируулагдсан. Эзэмшигч эсвэл админ ажлын эрхийг идэвхжүүлсний дараа дахин шалгана уу.")}</p>
      <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="signout">Гарах</button><button class="button button--primary" type="button" data-action="refresh-session">Эрх дахин шалгах</button></div>
    </section>
  </main>`;
}

export function loadingView(label = "Мэдээлэл ачаалж байна…") {
  return `<section class="state-card" role="status"><span class="spinner" aria-hidden="true"></span><p>${escapeHtml(label)}</p></section>`;
}

export function errorView(message, retryRoute = "") {
  return `<section class="state-card state-card--error" role="alert">
    <div class="state-icon">!</div>
    <h2>Мэдээлэл авахад алдаа гарлаа</h2>
    <p>${escapeHtml(message)}</p>
    ${retryRoute ? `<a class="button button--secondary" href="#${escapeHtml(retryRoute)}">Дахин оролдох</a>` : ""}
  </section>`;
}

export function restrictedAccessView() {
  return `<section class="state-card" role="status">
    <div class="security-illustration">${icon("shield")}</div>
    <h1>Хандалтын эрх хязгаарлагдсан</h1>
    <p>Таны бүртгэл идэвхтэй боловч энэ хувилбарт үйл ажиллагааны мэдээлэл харах эрхгүй байна. Эзэмшигч эсвэл админаас тохирох ажлын эрх хүснэ үү.</p>
  </section>`;
}

function navItems(user, activePath, mobile = false) {
  return visibleNavigation(user.role)
    .map((item) => {
      const active = activePath.startsWith(item.href.slice(1));
      return `<a class="nav-link${active ? " is-active" : ""}" href="${item.href}" ${
        active ? 'aria-current="page"' : ""
      }>${icon(item.icon)}<span>${escapeHtml(item.label)}</span></a>`;
    })
    .join("");
}

export function shellView({ user, activePath, content, localDemo = false }) {
  return `
    <div class="app-shell" data-shell>
      <aside class="sidebar" id="primary-navigation">
        <a class="brand-lockup brand-lockup--light" href="#/dashboard" aria-label="CRYO Mongolia хянах самбар">
          <span class="brand-symbol">°</span><span>CRYO MONGOLIA</span>
        </a>
        <nav class="primary-nav" aria-label="Үндсэн цэс">${navItems(user, activePath)}</nav>
        <div class="sidebar-profile">
          <span class="avatar avatar--small">${escapeHtml(initials(user))}</span>
          <span><strong>${escapeHtml(fullName(user))}</strong><small>${escapeHtml(roleLabel(user.role))}</small></span>
        </div>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <button class="icon-button menu-button" type="button" data-action="toggle-nav" aria-controls="primary-navigation" aria-expanded="false" aria-label="Цэс нээх">${icon("menu")}</button>
          ${
            can(user.role, "customers:view")
              ? `<div class="global-search-wrap">
                  <form class="global-search" data-form="global-search" role="search">
                    <label class="sr-only" for="global-search-input">Үйлчлүүлэгч хайх</label>
                    ${icon("search")}
                    <input id="global-search-input" name="query" type="search" role="combobox" aria-autocomplete="list" aria-controls="global-search-results" aria-expanded="false" placeholder="Нэр, утас, имэйлээр хайх…" autocomplete="off" />
                  </form>
                  <div id="global-search-results" class="search-results" role="listbox" aria-label="Хайлтын илэрц" hidden></div>
                </div>`
              : '<div class="topbar-spacer"></div>'
          }
          ${localDemo ? '<span class="demo-badge">LOCAL DEMO</span>' : ""}
          ${["owner", "admin"].includes(normalizeRole(user.role)) ? `<button class="icon-button" type="button" data-action="account-security" aria-label="MFA аюулгүй байдлын тохиргоо">${icon("shield")}</button>` : ""}
          <button class="icon-button" type="button" data-action="signout" aria-label="Системээс гарах">${icon("logout")}</button>
        </header>
        <main id="main-content" class="page-content" tabindex="-1">${content}</main>
        <nav class="mobile-nav" aria-label="Гар утасны үндсэн цэс">${navItems(user, activePath, true)}</nav>
      </div>
      <button class="nav-scrim" type="button" data-action="toggle-nav" aria-label="Цэс хаах"></button>
      <dialog id="erp-dialog" class="dialog"><div id="dialog-content"></div></dialog>
      <div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="true"></div>
    </div>`;
}

export function dashboardView(data) {
  const metrics = data?.metrics ?? {};
  const cards = [
    { label: "Нийт үйлчлүүлэгч", value: metrics.customerCount ?? 0, icon: "users", tone: "mint" },
    { label: "Идэвхтэй багц", value: metrics.activePackageCount ?? 0, icon: "package", tone: "blue" },
    { label: "Өнөөдрийн үйлчилгээ", value: metrics.todayVisitCount ?? 0, icon: "calendar", tone: "violet" },
    { label: "14 хоногт дуусах", value: metrics.expiringPackageCount ?? 0, icon: "money", tone: "gold" },
  ];

  return `
    <header class="page-header">
      <div><p class="eyebrow">Өнөөдрийн тойм</p><h1>Хянах самбар</h1><p class="muted">Үйл ажиллагааны гол үзүүлэлтүүд.</p></div>
      <a class="button button--primary" href="#/customers">${icon("users")} Үйлчлүүлэгч харах</a>
    </header>
    <section class="metric-grid" aria-label="Үндсэн үзүүлэлт">
      ${cards
        .map(
          (card) => `<article class="metric-card metric-card--${card.tone}">
            <span class="metric-icon">${icon(card.icon)}</span>
            <span class="metric-label">${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
          </article>`,
        )
        .join("")}
    </section>
    <section class="panel">
      <div class="panel-heading"><div><h2>Сүүлийн үйлчилгээ</h2><p>Хамгийн сүүлд бүртгэсэн хөдөлгөөн</p></div></div>
      ${recentVisitsTable(data?.recentVisits ?? [])}
    </section>`;
}

function visitStatus(status) {
  const states = {
    planned: ["Төлөвлөсөн", "status-pill--warning"],
    in_progress: ["Явагдаж буй", "status-pill--warning"],
    completed: ["Хийгдсэн", "status-pill--success"],
    cancelled: ["Цуцлагдсан", ""],
    corrected: ["Залруулсан", "status-pill--warning"],
  };
  return states[status] ?? ["Тодорхойгүй", ""];
}

function recentVisitsTable(visits) {
  if (!visits.length) return emptyState("Үйлчилгээ бүртгэгдээгүй", "Шинэ үйлчилгээ бүртгэгдэхэд энд харагдана.");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Үйлчлүүлэгч</th><th>Үйлчилгээ</th><th>Ажилтан</th><th>Огноо</th><th>Төлөв</th></tr></thead>
    <tbody>${visits
      .map((visit) => {
        const [label, tone] = visitStatus(visit.status);
        return `<tr>
          <td><a class="table-link" href="#/customers/${encodeURIComponent(visit.customerId)}">${escapeHtml(visit.customerName)}</a></td>
          <td>${escapeHtml(visit.serviceName)}</td><td>${escapeHtml(visit.staffName)}</td>
          <td>${escapeHtml(formatDate(visit.occurredAt, { hour: "2-digit", minute: "2-digit" }))}</td>
          <td><span class="status-pill ${tone}">${escapeHtml(label)}</span></td>
        </tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

export function customersView({ result, query = "", role }) {
  const items = result?.items ?? [];
  const page = Number(result?.page ?? 1);
  const pageSize = Number(result?.pageSize ?? 25);
  const total = Number(result?.total ?? items.length);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const countLabel = result?.queryTooShort
    ? "Хайлт хийхэд 2-оос доошгүй тэмдэг оруулна уу"
    : result?.truncated
      ? `Эхний ${escapeHtml(total)}+ илэрц`
      : `Нийт ${escapeHtml(total)} бүртгэл`;
  return `
    <header class="page-header">
      <div><p class="eyebrow">Харилцагчийн бүртгэл</p><h1>Үйлчлүүлэгчид</h1><p class="muted">${countLabel}</p></div>
      ${can(role, "customers:create") ? `<button class="button button--primary" type="button" data-action="customer-add">${icon("plus")} Шинэ үйлчлүүлэгч</button>` : ""}
    </header>
    <section class="panel">
      <form class="filter-bar" data-form="customer-filter" role="search">
        <label class="search-field">${icon("search")}<span class="sr-only">Жагсаалтаас хайх</span><input name="query" type="search" value="${escapeHtml(query)}" placeholder="Нэр, утас, имэйл…" minlength="2" aria-describedby="customer-filter-help" /></label>
        <span class="sr-only" id="customer-filter-help">Хайлт хийх бол 2-оос доошгүй тэмдэг оруулна уу.</span>
        <button class="button button--secondary" type="submit">Хайх</button>
      </form>
      ${items.length ? customerTable(items) : emptyState("Илэрц олдсонгүй", result?.queryTooShort ? "Хайлт хийх бол 2-оос доошгүй тэмдэг оруулна уу." : query ? "Хайлтын үгээ өөрчилж үзнэ үү." : "Анхны үйлчлүүлэгчээ бүртгэнэ үү.")}
      ${
        items.length && totalPages > 1
          ? `<nav class="pagination" aria-label="Үйлчлүүлэгчийн хуудас"><button class="button button--small button--secondary" type="button" data-action="customer-page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>← Өмнөх</button><span>${escapeHtml(page)} / ${escapeHtml(totalPages)}</span><button class="button button--small button--secondary" type="button" data-action="customer-page" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>Дараах →</button></nav>`
          : ""
      }
    </section>`;
}

function customerTable(customers) {
  return `<div class="table-wrap"><table class="customer-table">
    <thead><tr><th>Үйлчлүүлэгч</th><th>Утас</th><th>Идэвхтэй эрх</th><th>Сүүлд шинэчилсэн</th><th><span class="sr-only">Үйлдэл</span></th></tr></thead>
    <tbody>${customers
      .map((customer) => {
        const active = (customer.entitlements ?? []).filter(
          (item) => item.available ?? remainingCount(item) > 0,
        ).length;
        return `<tr>
          <td><div class="person-cell"><span class="avatar">${escapeHtml(initials(customer))}</span><span><strong>${escapeHtml(fullName(customer))}</strong><small>${escapeHtml(customer.email || "Имэйлгүй")}</small></span></div></td>
          <td>${escapeHtml(maskPhone(customer.phone))}</td><td>${escapeHtml(active)}</td><td>${escapeHtml(formatDate(customer.updatedAt))}</td>
          <td><a class="row-action" href="#/customers/${encodeURIComponent(customer.id)}" aria-label="${escapeHtml(fullName(customer))} дэлгэрэнгүй">Дэлгэрэнгүй →</a></td>
        </tr>`;
      })
      .join("")}</tbody>
  </table></div>`;
}

export function customerDetailView(customer, role) {
  const entitlements = customer.entitlements ?? [];
  const visits = customer.visits ?? [];
  const canViewPayments = can(role, "payments:view");
  const payments = canViewPayments && Array.isArray(customer.payments) ? customer.payments : [];
  return `
    <a class="back-link" href="#/customers">${icon("arrow")} Жагсаалт руу буцах</a>
    <header class="customer-hero">
      <div class="person-cell person-cell--large"><span class="avatar avatar--large">${escapeHtml(initials(customer))}</span><span><p class="eyebrow">Үйлчлүүлэгч</p><h1>${escapeHtml(fullName(customer))}</h1><small>${escapeHtml(maskPhone(customer.phone))} · ${escapeHtml(customer.email || "Имэйлгүй")}</small></span></div>
      ${can(role, "customers:edit") ? `<button class="button button--secondary" type="button" data-action="customer-edit" data-customer-id="${escapeHtml(customer.id)}">${icon("edit")} Мэдээлэл засах</button>` : ""}
    </header>
    ${customer.note ? `<div class="note-strip"><strong>Тэмдэглэл</strong><span>${escapeHtml(customer.note)}</span></div>` : ""}
    <section class="detail-grid">
      <article class="panel detail-main">
        <div class="panel-heading"><div><h2>Багцын эрх</h2><p>Үлдэгдэл болон дуусах хугацаа</p></div>
          ${can(role, "packages:create") ? `<button class="button button--small button--secondary" type="button" data-action="package-add" data-customer-id="${escapeHtml(customer.id)}">${icon("plus")} Багц / эрх нэмэх</button>` : ""}
        </div>
        ${entitlements.length ? entitlementCards(customer.id, entitlements, role) : emptyState("Идэвхтэй багцгүй", "Багцын эрх backend системээс нэмэгдэнэ.")}
      </article>
      <aside class="panel customer-summary">
        <h2>Товч мэдээлэл</h2>
        <dl><div><dt>Бүртгүүлсэн</dt><dd>${escapeHtml(formatDate(customer.createdAt))}</dd></div><div><dt>Сүүлд шинэчилсэн</dt><dd>${escapeHtml(formatDate(customer.updatedAt))}</dd></div><div><dt>Нийт үйлчилгээ</dt><dd>${escapeHtml(visits.length)}</dd></div>${canViewPayments ? `<div><dt>Төлбөрийн гүйлгээ</dt><dd>${escapeHtml(payments.length)}</dd></div>` : ""}</dl>
      </aside>
    </section>
    ${
      canViewPayments
        ? `<section class="panel tabs-panel">
            <div class="tab-buttons" role="tablist" aria-label="Үйлчлүүлэгчийн түүх">
              <button id="visits-tab" class="tab-button is-active" type="button" role="tab" aria-selected="true" aria-controls="visits-panel" tabindex="0" data-action="tab" data-tab="visits-panel">Үйлчилгээний түүх</button>
              <button id="payments-tab" class="tab-button" type="button" role="tab" aria-selected="false" aria-controls="payments-panel" tabindex="-1" data-action="tab" data-tab="payments-panel">Төлбөрийн түүх</button>
            </div>
            <div id="visits-panel" class="tab-panel" role="tabpanel" aria-labelledby="visits-tab">${visitsTable(visits)}</div>
            <div id="payments-panel" class="tab-panel" role="tabpanel" aria-labelledby="payments-tab" hidden>${paymentsTable(payments)}</div>
          </section>`
        : `<section class="panel"><div class="panel-heading"><div><h2>Үйлчилгээний түүх</h2><p>Бүртгэгдсэн үйлчилгээний хөдөлгөөн</p></div></div>${visitsTable(visits)}</section>`
    }`;
}

function entitlementCards(customerId, entitlements, role) {
  return `<div class="package-list">${entitlements
    .map((item) => {
      const remaining = remainingCount(item);
      const total = Number(item.totalCount || 0);
      const percent = total > 0 ? Math.min(100, Math.round((remaining / total) * 100)) : 0;
      const available = item.available ?? (item.status === "active" && remaining > 0);
      const statusLabels = {
        active: "Идэвхтэй",
        completed: "Дууссан",
        expired: "Хугацаа дууссан",
        scheduled: "Эхлэх хүлээгдэж буй",
        cancelled: "Цуцлагдсан",
      };
      const statusLabel = statusLabels[item.status] ?? (available ? "Идэвхтэй" : "Идэвхгүй");
      return `<article class="package-card">
        <div class="package-top"><span class="metric-icon metric-card--mint">${icon("package")}</span><span><strong>${escapeHtml(item.name)}</strong><small>Дуусах: ${escapeHtml(formatDate(item.expiresAt))}</small></span><span class="package-count"><strong>${escapeHtml(remaining)}</strong><small>үлдсэн / ${escapeHtml(total)}</small></span></div>
        <progress class="progress" max="100" value="${percent}" aria-label="${escapeHtml(item.name)} ${escapeHtml(percent)} хувь үлдсэн">${percent}%</progress>
        <div class="package-actions"><span class="status-pill ${available ? "status-pill--success" : "status-pill--warning"}">${escapeHtml(statusLabel)}</span>
          ${can(role, "entitlements:consume") && available ? `<button class="button button--small button--primary" type="button" data-action="consume" data-customer-id="${escapeHtml(customerId)}" data-entitlement-id="${escapeHtml(item.id)}">Үйлчилгээ хасах</button>` : ""}
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function visitsTable(visits) {
  if (!visits.length) return emptyState("Үйлчилгээний түүхгүй", "Үйлчилгээ хийгдэхэд энд бүртгэгдэнэ.");
  return `<div class="table-wrap"><table><thead><tr><th>Огноо</th><th>Үйлчилгээ</th><th>Ажилтан</th><th>Тэмдэглэл</th><th>Төлөв</th></tr></thead><tbody>${visits
    .map((item) => {
      const [label, tone] = visitStatus(item.status);
      return `<tr><td>${escapeHtml(formatDate(item.occurredAt, { hour: "2-digit", minute: "2-digit" }))}</td><td>${escapeHtml(item.serviceName)}</td><td>${escapeHtml(item.staffName)}</td><td>${escapeHtml(item.note || "—")}</td><td><span class="status-pill ${tone}">${escapeHtml(label)}</span></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function paymentsTable(payments) {
  if (!payments.length) return emptyState("Төлбөрийн түүхгүй", "Төлбөр баталгаажихад энд бүртгэгдэнэ.");
  return `<div class="table-wrap"><table><thead><tr><th>Огноо</th><th>Дүн</th><th>Хэлбэр</th><th>Лавлагаа</th><th>Төлөв</th></tr></thead><tbody>${payments
    .map((item) => {
      const statuses = {
        paid: ["Төлөгдсөн", "status-pill--success"],
        refunded: ["Буцаалт", "status-pill--warning"],
        adjusted: ["Залруулга", "status-pill--warning"],
      };
      const [label, tone] = statuses[item.status] ?? ["Тодорхойгүй", ""];
      const amount = item.status === "refunded" ? `−${formatMoney(item.amount)}` : formatMoney(item.amount);
      return `<tr><td>${escapeHtml(formatDate(item.paidAt))}</td><td><strong>${escapeHtml(amount)}</strong></td><td>${escapeHtml(item.method)}</td><td>${escapeHtml(item.reference || "—")}</td><td><span class="status-pill ${tone}">${escapeHtml(label)}</span></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

export function staffView(staff, role, currentUserId) {
  return `
    <header class="page-header"><div><p class="eyebrow">Эрх ба баг</p><h1>Ажилтнууд</h1><p class="muted">Ажилтны эрхийг backend role-оор хязгаарлана.</p></div>
      ${can(role, "staff:invite") ? `<button class="button button--primary" type="button" data-action="staff-invite">${icon("plus")} Ажилтан урих</button>` : ""}
    </header>
    <section class="panel">
      ${
        staff.length
          ? `<div class="staff-grid">${staff
              .map(
                (person) => {
                  const canEdit =
                    can(role, "staff:update") &&
                    person.id !== currentUserId &&
                    (normalizeRole(role) === "owner" || !["owner", "admin"].includes(person.role));
                  const statusLabel =
                    person.status === "active"
                      ? "Идэвхтэй"
                      : person.status === "suspended"
                        ? "Түдгэлзсэн"
                        : "Урилга хүлээгдэж буй";
                  return `<article class="staff-card"><span class="avatar avatar--large">${escapeHtml(initials(person))}</span><div class="staff-card__body"><h2>${escapeHtml(fullName(person))}</h2><p>${escapeHtml(person.email)}</p><div><span class="role-pill">${escapeHtml(roleLabel(person.role))}</span><span class="status-pill ${person.status === "active" ? "status-pill--success" : "status-pill--warning"}">${escapeHtml(statusLabel)}</span></div></div>${canEdit ? `<button class="icon-button" type="button" data-action="staff-edit" data-staff-id="${escapeHtml(person.id)}" aria-label="${escapeHtml(fullName(person))} эрх засах">${icon("edit")}</button>` : ""}</article>`;
                },
              )
              .join("")}</div>`
          : emptyState("Ажилтан олдсонгүй", "Backend холболт болон эрхээ шалгана уу.")
      }
    </section>`;
}

export function emptyState(title, message) {
  return `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">°</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`;
}

export function globalSearchResults(items) {
  if (!items.length) return `<div class="search-empty">Илэрц олдсонгүй.</div>`;
  return `<ul>${items
    .map(
      (customer) => `<li><a role="option" href="#/customers/${encodeURIComponent(customer.id)}"><span class="avatar avatar--small">${escapeHtml(initials(customer))}</span><span><strong>${escapeHtml(fullName(customer))}</strong><small>${escapeHtml(maskPhone(customer.phone))} · ${escapeHtml(customer.email || "Имэйлгүй")}</small></span></a></li>`,
    )
    .join("")}</ul>`;
}

export function customerForm(customer = null) {
  const editing = Boolean(customer);
  return `<form class="dialog-form" data-form="customer" data-customer-id="${escapeHtml(customer?.id ?? "")}">
    <div class="dialog-heading"><div><p class="eyebrow">${editing ? "Бүртгэл засах" : "Шинэ бүртгэл"}</p><h2>${editing ? "Үйлчлүүлэгчийн мэдээлэл" : "Шинэ үйлчлүүлэгч"}</h2></div><button class="icon-button" type="button" data-action="dialog-close" aria-label="Цонх хаах">${icon("close")}</button></div>
    <div class="form-grid">
      <label class="field"><span>Овог *</span><input name="lastName" value="${escapeHtml(customer?.lastName ?? "")}" autocomplete="family-name" required /></label>
      <label class="field"><span>Нэр *</span><input name="firstName" value="${escapeHtml(customer?.firstName ?? "")}" autocomplete="given-name" required /></label>
      <label class="field"><span>Утас *</span><input name="phone" value="${escapeHtml(customer?.phone ?? "")}" inputmode="tel" autocomplete="tel" required /></label>
      <label class="field"><span>Имэйл</span><input name="email" type="email" value="${escapeHtml(customer?.email ?? "")}" autocomplete="email" /></label>
      <label class="field field--full"><span>Тэмдэглэл</span><textarea name="note" rows="3" maxlength="500">${escapeHtml(customer?.note ?? "")}</textarea></label>
    </div>
    <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="dialog-close">Болих</button><button class="button button--primary" type="submit">${editing ? "Хадгалах" : "Бүртгэх"}</button></div>
  </form>`;
}

export function consumeForm(customerId, entitlement) {
  const remaining = remainingCount(entitlement);
  return `<form class="dialog-form" data-form="consume" data-customer-id="${escapeHtml(customerId)}" data-entitlement-id="${escapeHtml(entitlement.id)}">
    <div class="dialog-heading"><div><p class="eyebrow">Баталгаажуулалт</p><h2>Үйлчилгээний эрх хасах</h2></div><button class="icon-button" type="button" data-action="dialog-close" aria-label="Цонх хаах">${icon("close")}</button></div>
    <div class="confirm-card"><span class="metric-icon metric-card--mint">${icon("package")}</span><div><strong>${escapeHtml(entitlement.name)}</strong><p>Одоогийн үлдэгдэл: <b>${escapeHtml(remaining)}</b></p></div></div>
    <label class="field"><span>Хасах тоо *</span><input name="quantity" type="number" min="1" max="${escapeHtml(remaining)}" value="1" required /></label>
    <label class="field"><span>Тэмдэглэл</span><textarea name="note" rows="3" maxlength="300" placeholder="Шаардлагатай бол…"></textarea></label>
    <div class="alert alert--warning"><strong>Анхаар:</strong> Баталгаажуулсны дараа backend аудитын хөдөлгөөн үүсгэнэ. Алдаатай бол админ засварын урсгалаар залруулна.</div>
    <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="dialog-close">Болих</button><button class="button button--primary" type="submit">${icon("check")} Баталгаажуулж хасах</button></div>
  </form>`;
}

export function inviteForm(callerRole, idempotencyKey) {
  const privilegedOptions =
    normalizeRole(callerRole) === "owner"
      ? '<option value="admin">Админ</option><option value="owner">Эзэмшигч</option>'
      : "";
  return `<form class="dialog-form" data-form="invite" data-idempotency-key="${escapeHtml(idempotencyKey)}">
    <div class="dialog-heading"><div><p class="eyebrow">Эрхийн урилга</p><h2>Ажилтан урих</h2></div><button class="icon-button" type="button" data-action="dialog-close" aria-label="Цонх хаах">${icon("close")}</button></div>
    <div class="form-grid">
      <label class="field"><span>Овог</span><input name="lastName" autocomplete="family-name" /></label><label class="field"><span>Нэр *</span><input name="firstName" minlength="2" maxlength="160" autocomplete="given-name" required /></label>
      <label class="field field--full"><span>Ажлын имэйл *</span><input name="email" type="email" autocomplete="off" required /></label>
      <label class="field field--full"><span>Эрхийн түвшин *</span><select name="role" required><option value="viewer">Харах эрхтэй</option><option value="therapist">Терапист</option><option value="reception">Ресепшн</option><option value="accountant">Нягтлан</option><option value="auditor">Аудитор</option><option value="manager">Менежер</option>${privilegedOptions}</select></label>
    </div>
    <div class="alert alert--info">Урилга илгээх, хугацаа, дахин илгээх ажиллагааг backend adapter хариуцна.</div>
    <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="dialog-close">Болих</button><button class="button button--primary" type="submit">Урилга илгээх</button></div>
  </form>`;
}

export function packageForm(customerId, services, now = new Date()) {
  const today = businessDate(now);
  return `<form class="dialog-form" data-form="package" data-customer-id="${escapeHtml(customerId)}">
    <div class="dialog-heading"><div><p class="eyebrow">Шинэ эрх</p><h2>Багц / эрх нэмэх</h2></div><button class="icon-button" type="button" data-action="dialog-close" aria-label="Цонх хаах">${icon("close")}</button></div>
    <div class="form-grid">
      <label class="field field--full"><span>Багцын нэр *</span><input name="name" minlength="2" maxlength="160" required /></label>
      <label class="field"><span>Худалдан авсан огноо</span><input name="purchasedAt" type="datetime-local" /></label>
      <label class="field"><span>Эхлэх өдөр *</span><input name="startsOn" type="date" value="${today}" required /></label>
      <label class="field"><span>Дуусах өдөр</span><input name="expiresOn" type="date" min="${today}" /></label>
      <label class="field"><span>Үнэ (₮)</span><input name="price" type="number" min="0" step="1" inputmode="numeric" /></label>
      <label class="field"><span>Үйлчилгээ *</span><select name="serviceId" required><option value="">Сонгоно уу</option>${services
        .map((service) => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)}</option>`)
        .join("")}</select></label>
      <label class="field"><span>Эрхийн тоо *</span><input name="quantity" type="number" min="1" max="10000" value="1" required inputmode="numeric" /></label>
      <label class="field field--full"><span>Тэмдэглэл</span><textarea name="notes" rows="3" maxlength="4000"></textarea></label>
    </div>
    <div class="alert alert--info">Багц нэмэхэд сонгосон үйлчилгээний ашиглагдаагүй эрх үүснэ. Энэ үйлдэл audit түүхтэй байна.</div>
    <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="dialog-close">Болих</button><button class="button button--primary" type="submit">Багц үүсгэх</button></div>
  </form>`;
}

export function staffAccessForm(person, callerRole) {
  const owner = normalizeRole(callerRole) === "owner";
  const roles = [
    ...(owner
      ? [
          ["owner", "Эзэмшигч"],
          ["admin", "Админ"],
        ]
      : []),
    ["manager", "Менежер"],
    ["reception", "Ресепшн"],
    ["therapist", "Терапист"],
    ["accountant", "Нягтлан"],
    ["auditor", "Аудитор"],
    ["viewer", "Харах эрхтэй"],
  ];
  if (!roles.some(([value]) => value === person.role)) roles.push([person.role, roleLabel(person.role)]);

  return `<form class="dialog-form" data-form="staff-access" data-staff-id="${escapeHtml(person.id)}">
    <div class="dialog-heading"><div><p class="eyebrow">Хандалтын удирдлага</p><h2>${escapeHtml(fullName(person))}</h2><p class="muted">${escapeHtml(person.email)}</p></div><button class="icon-button" type="button" data-action="dialog-close" aria-label="Цонх хаах">${icon("close")}</button></div>
    <label class="field"><span>Эрхийн түвшин *</span><select name="role" required>${roles
      .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === person.role ? "selected" : ""}>${escapeHtml(label)}</option>`)
      .join("")}</select></label>
    <label class="field"><span>Төлөв *</span><select name="status" required><option value="invited" ${person.status === "invited" ? "selected" : ""}>Урилга хүлээгдэж буй</option><option value="active" ${person.status === "active" ? "selected" : ""}>Идэвхтэй</option><option value="suspended" ${person.status === "suspended" ? "selected" : ""}>Түдгэлзсэн</option></select></label>
    <label class="field"><span>Өөрчлөлтийн шалтгаан *</span><textarea name="reason" rows="3" minlength="3" maxlength="1000" placeholder="Яагаад энэ эрхийг өөрчилж байгааг бичнэ үү" required></textarea></label>
    <div class="alert alert--warning"><strong>Анхаар:</strong> Системд дор хаяж нэг идэвхтэй эзэмшигч заавал үлдэнэ. Өөрийн эрхийг өөрөө түдгэлзүүлэх боломжгүй.</div>
    <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="dialog-close">Болих</button><button class="button button--primary" type="submit">Эрх шинэчлэх</button></div>
  </form>`;
}

export function mfaSetupPrompt() {
  return `<section class="dialog-form" aria-labelledby="mfa-setup-title">
    <div class="dialog-heading"><div><p class="eyebrow">Дансны аюулгүй байдал</p><h2 id="mfa-setup-title">MFA идэвхжүүлэх шаардлагатай</h2></div><button class="icon-button" type="button" data-action="dialog-close" aria-label="Цонх хаах">${icon("close")}</button></div>
    <div class="security-illustration">${icon("shield")}</div>
    <p class="muted">Ажилтан урих болон эрх өөрчлөхийн өмнө authenticator апп-аар хоёр шатлалт баталгаажуулалт хийнэ.</p>
    <ol class="setup-steps"><li>Google Authenticator, Microsoft Authenticator эсвэл ижил төрлийн апп бэлтгэнэ.</li><li>Дараагийн QR кодыг уншуулна.</li><li>Апп-д гарсан 6 оронтой кодыг баталгаажуулна.</li></ol>
    <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="dialog-close">Болих</button><button class="button button--primary" type="button" data-action="mfa-enroll">MFA тохируулах</button></div>
  </section>`;
}

export function mfaVerifyForm({ factorId, qrCode = "", secret = "" }) {
  const enrolling = Boolean(qrCode);
  return `<form class="dialog-form" data-form="mfa-verify" data-factor-id="${escapeHtml(factorId)}">
    <div class="dialog-heading"><div><p class="eyebrow">Хоёр шатлалт баталгаажуулалт</p><h2>${enrolling ? "QR код уншуулах" : "Authenticator код"}</h2></div><button class="icon-button" type="button" data-action="dialog-close" aria-label="Цонх хаах">${icon("close")}</button></div>
    ${
      enrolling
        ? `<div class="mfa-enrollment"><img class="mfa-qr" src="${escapeHtml(qrCode)}" alt="Authenticator апп-аар уншуулах QR код" /><p>QR унших боломжгүй бол setup key-г гараар оруулна:</p><code class="mfa-secret">${escapeHtml(secret)}</code></div>`
        : `<div class="alert alert--info">Authenticator апп-д харагдаж буй нэг удаагийн кодыг оруулна уу.</div>`
    }
    <label class="field"><span>6 оронтой код *</span><input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required /></label>
    <div class="dialog-actions"><button class="button button--ghost" type="button" data-action="dialog-close">Болих</button><button class="button button--primary" type="submit">${icon("shield")} Баталгаажуулах</button></div>
  </form>`;
}
