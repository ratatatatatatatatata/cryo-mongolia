/* ══════════════════════════════════════════════════════════════
   °CRYO Mongolia — customer accounts
   Register / sign in, book while signed in, review your own bookings.
   Only `admin` and `owner` see the dashboard link; everyone else is
   simply a customer.
   ══════════════════════════════════════════════════════════════ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.CRYO_SUPABASE || {};
const sb = CFG.url && CFG.anonKey ? createClient(CFG.url, CFG.anonKey) : null;

const $ = (id) => document.getElementById(id);
const money = (n) => "₮" + Number(n || 0).toLocaleString("en-US");
const STATUS_MN = {
  pending: "Хүлээгдэж буй",
  confirmed: "Баталгаажсан",
  done: "Биелсэн",
  cancelled: "Цуцалсан",
};

let session = null;
let profile = null;
let afterLogin = null; // what to run once the visitor is signed in

/* ── shared account state for the rest of the site ── */
window.cryoAuth = {
  ready: !!sb,
  get user() {
    return session ? session.user : null;
  },
  get profile() {
    return profile;
  },
  isAdmin: () => !!profile && (profile.role === "admin" || profile.role === "owner"),
  require(then) {
    if (!sb) {
      if (then) then();
      return true;
    }
    if (session) {
      if (then) then();
      return true;
    }
    afterLogin = then || null;
    openAuth("signin");
    return false;
  },
};

/* ══════════════════════════════════════════════════════════════
   MARKUP (injected so index.html stays readable)
   ══════════════════════════════════════════════════════════════ */
function injectMarkup() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
<div class="modal-overlay" id="authOverlay">
  <div class="modal auth-modal">
    <button class="modal-close" data-close-auth>✕</button>
    <h3 id="authTitle">Нэвтрэх</h3>
    <p class="auth-lead" id="authLead">Цаг захиалахын тулд бүртгэлдээ нэвтэрнэ үү.</p>

    <div class="gate-tabs auth-tabs">
      <button type="button" class="on" data-auth-mode="signin">Нэвтрэх</button>
      <button type="button" data-auth-mode="signup">Бүртгүүлэх</button>
    </div>

    <div id="authNote"></div>

    <form id="cAuthForm">
      <div class="form-group" id="cNameWrap" style="display:none;">
        <label for="c_name">Нэр</label>
        <input type="text" id="c_name" autocomplete="name" placeholder="Таны нэр"/>
      </div>
      <div class="form-group">
        <label for="c_email">И-мэйл</label>
        <input type="email" id="c_email" autocomplete="email" required placeholder="example@mail.mn"/>
      </div>
      <div class="form-group">
        <label for="c_pass">Нууц үг</label>
        <input type="password" id="c_pass" autocomplete="current-password" required minlength="6" placeholder="••••••••"/>
      </div>
      <button type="submit" class="btn btn-primary" id="cAuthBtn" style="width:100%;margin-top:8px;">Нэвтрэх</button>
    </form>
  </div>
</div>

<div class="modal-overlay" id="myOverlay">
  <div class="modal">
    <button class="modal-close" data-close-my>✕</button>
    <h3>Миний захиалга</h3>
    <p class="auth-lead" id="myLead">—</p>
    <div id="myList"></div>
  </div>
</div>`;
  while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
}

/* ══════════════════════════════════════════════════════════════
   NAV
   ══════════════════════════════════════════════════════════════ */
function renderNav() {
  const login = document.querySelector(".nav-login");
  const menu = $("mobileMenu");
  if (!login) return;

  const oldAcct = document.querySelector(".nav-account");
  if (oldAcct) oldAcct.remove();
  document.querySelectorAll("[data-acct-mobile]").forEach((el) => el.remove());

  if (!session) {
    login.style.display = "";
    return;
  }
  login.style.display = "none";

  const name =
    (profile && profile.full_name) ||
    (session.user.user_metadata && session.user.user_metadata.full_name) ||
    session.user.email.split("@")[0];

  const box = document.createElement("div");
  box.className = "nav-account";
  box.innerHTML = `
    <button class="nav-login acct-trigger" type="button" aria-haspopup="true" aria-expanded="false">
      <span class="nl-ic" aria-hidden="true">◐</span><span class="acct-name"></span>
    </button>
    <div class="acct-menu">
      <div class="acct-head"><b class="acct-mail"></b><span class="acct-role"></span></div>
      <button type="button" data-act="mine">Миний захиалга</button>
      <a data-act="admin" href="admin.html">Админ самбар</a>
      <button type="button" data-act="out">Гарах</button>
    </div>`;
  box.querySelector(".acct-name").textContent = name;
  box.querySelector(".acct-mail").textContent = session.user.email;
  box.querySelector(".acct-role").textContent = window.cryoAuth.isAdmin()
    ? profile.role === "owner"
      ? "Үндсэн админ"
      : "Админ"
    : "Үйлчлүүлэгч";
  box.querySelector('[data-act="admin"]').style.display = window.cryoAuth.isAdmin() ? "" : "none";

  const trigger = box.querySelector(".acct-trigger");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = box.classList.toggle("open");
    trigger.setAttribute("aria-expanded", String(on));
  });
  document.addEventListener("click", () => box.classList.remove("open"));
  box.querySelector('[data-act="mine"]').addEventListener("click", openMine);
  box.querySelector('[data-act="out"]').addEventListener("click", () => sb.auth.signOut());

  login.parentElement.insertBefore(box, login);

  if (menu) {
    const frag = document.createElement("div");
    frag.dataset.acctMobile = "1";
    frag.style.cssText = "display:flex;flex-direction:column;gap:14px;align-items:center";
    const mine = document.createElement("a");
    mine.href = "#";
    mine.className = "btn btn-outline";
    mine.textContent = "Миний захиалга";
    mine.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof toggleMenu === "function") toggleMenu();
      openMine();
    });
    frag.appendChild(mine);
    if (window.cryoAuth.isAdmin()) {
      const ad = document.createElement("a");
      ad.href = "admin.html";
      ad.className = "btn btn-outline";
      ad.textContent = "Админ самбар";
      frag.appendChild(ad);
    }
    const out = document.createElement("a");
    out.href = "#";
    out.className = "btn btn-outline";
    out.textContent = "Гарах";
    out.addEventListener("click", (e) => {
      e.preventDefault();
      sb.auth.signOut();
      if (typeof toggleMenu === "function") toggleMenu();
    });
    frag.appendChild(out);
    menu.appendChild(frag);

    const mLogin = menu.querySelector('a[href="admin.html"].btn:not([data-acct-mobile] *)');
    if (mLogin && mLogin.textContent.includes("Админ нэвтрэх")) mLogin.style.display = "none";
  }
}

/* ══════════════════════════════════════════════════════════════
   AUTH MODAL
   ══════════════════════════════════════════════════════════════ */
let authMode = "signin";

function openAuth(mode, lead) {
  authMode = mode || "signin";
  setMode(authMode);
  $("authLead").textContent = lead || "Цаг захиалахын тулд бүртгэлдээ нэвтэрнэ үү.";
  $("authNote").innerHTML = "";
  $("authOverlay").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeAuth() {
  $("authOverlay").classList.remove("open");
  document.body.style.overflow = "";
}
function setMode(m) {
  authMode = m;
  document.querySelectorAll("[data-auth-mode]").forEach((b) =>
    b.classList.toggle("on", b.dataset.authMode === m),
  );
  $("cNameWrap").style.display = m === "signup" ? "" : "none";
  $("authTitle").textContent = m === "signup" ? "Бүртгүүлэх" : "Нэвтрэх";
  $("cAuthBtn").textContent = m === "signup" ? "Бүртгүүлэх" : "Нэвтрэх";
  $("c_pass").setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
}
function note(kind, text) {
  $("authNote").innerHTML = "";
  const d = document.createElement("div");
  d.className = "auth-note " + kind;
  d.textContent = text;
  $("authNote").appendChild(d);
}

function wireAuth() {
  $("authOverlay").addEventListener("click", (e) => {
    if (e.target.id === "authOverlay" || e.target.hasAttribute("data-close-auth")) closeAuth();
  });
  $("myOverlay").addEventListener("click", (e) => {
    if (e.target.id === "myOverlay" || e.target.hasAttribute("data-close-my")) {
      $("myOverlay").classList.remove("open");
      document.body.style.overflow = "";
    }
  });
  document.querySelectorAll("[data-auth-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      setMode(b.dataset.authMode);
      $("authNote").innerHTML = "";
    }),
  );

  $("cAuthForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("cAuthBtn");
    const email = $("c_email").value.trim();
    const password = $("c_pass").value;
    btn.disabled = true;

    if (authMode === "signup") {
      const { error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: $("c_name").value.trim() } },
      });
      btn.disabled = false;
      if (error) return note("err", error.message);
      note("ok", "Бүртгэл үүслээ. И-мэйл баталгаажуулалт шаардвал шуудангаа шалгана уу.");
      return;
    }

    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) return note("err", error.message);
    closeAuth();
  });

  const navLogin = document.querySelector(".nav-login");
  if (navLogin) {
    navLogin.setAttribute("href", "#");
    navLogin.addEventListener("click", (e) => {
      e.preventDefault();
      openAuth("signin", "Бүртгэлдээ нэвтэрч, цагаа захиална уу.");
    });
  }
  document.querySelectorAll('#mobileMenu a[href="admin.html"]').forEach((a) => {
    a.textContent = "Нэвтрэх / Бүртгүүлэх";
    a.setAttribute("href", "#");
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (typeof toggleMenu === "function") toggleMenu();
      openAuth("signin");
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   MY BOOKINGS
   ══════════════════════════════════════════════════════════════ */
async function openMine() {
  $("myOverlay").classList.add("open");
  document.body.style.overflow = "hidden";
  const list = $("myList");
  list.innerHTML = '<p class="auth-lead">Уншиж байна…</p>';

  const { data, error } = await sb
    .from("bookings")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = "";
    const d = document.createElement("div");
    d.className = "auth-note err";
    d.textContent = error.message;
    list.appendChild(d);
    return;
  }
  $("myLead").textContent = session.user.email;

  if (!data.length) {
    list.innerHTML =
      '<p class="auth-lead" style="padding:22px 0">Одоогоор захиалга алга байна.</p>';
    return;
  }

  list.innerHTML = "";
  data.forEach((b) => {
    const row = document.createElement("div");
    row.className = "my-row";
    const left = document.createElement("div");
    const ref = document.createElement("div");
    ref.className = "my-ref";
    ref.textContent = b.ref;
    const when = document.createElement("div");
    when.className = "my-when";
    when.textContent = (b.booked_date || "—") + " · " + (b.booked_time || "—");
    left.append(ref, when);

    const right = document.createElement("div");
    right.style.cssText = "text-align:right;display:flex;flex-direction:column;gap:8px;align-items:flex-end";
    const pill = document.createElement("span");
    pill.className = "my-pill st-" + b.status;
    pill.textContent = STATUS_MN[b.status] || b.status;
    const amt = document.createElement("div");
    amt.className = "my-amt";
    amt.textContent = money(b.amount);
    right.append(pill, amt);

    if (b.status === "pending") {
      const cancel = document.createElement("button");
      cancel.className = "btn-ghost";
      cancel.style.margin = "0";
      cancel.textContent = "Цуцлах";
      cancel.addEventListener("click", async () => {
        if (!confirm("Энэ захиалгыг цуцлах уу?")) return;
        cancel.disabled = true;
        const { error: e2 } = await sb
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("id", b.id);
        if (e2) {
          alert("Цуцалж чадсангүй: " + e2.message);
          cancel.disabled = false;
          return;
        }
        openMine();
      });
      right.appendChild(cancel);
    }

    row.append(left, right);
    list.appendChild(row);
  });
}

/* ══════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════ */
async function refresh() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  profile = null;
  if (session) {
    const { data: p } = await sb
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("id", session.user.id)
      .maybeSingle();
    profile = p || { id: session.user.id, email: session.user.email, role: "customer" };
  }
  renderNav();
  if (session && afterLogin) {
    const fn = afterLogin;
    afterLogin = null;
    closeAuth();
    setTimeout(fn, 120);
  }
}

(function boot() {
  if (!sb) return; // no Supabase yet: the site works exactly as before
  injectMarkup();
  wireAuth();
  sb.auth.onAuthStateChange(() => refresh());
  refresh();
})();
