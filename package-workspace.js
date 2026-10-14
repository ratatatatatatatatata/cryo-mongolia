import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { matchesName } from "./name-search.js";

const CFG = window.CRYO_SUPABASE || {};
const sb = createClient(CFG.url, CFG.anonKey);
const $ = (id) => document.getElementById(id);
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

let customers = [], packages = [], staff = [], leads = [], contracts = [], redemptions = [], services = [];
let profile = {}, user = null, selectedContractId = null, packageSearch = "";
const money = value => '₮' + Number(value || 0).toLocaleString('en-US');

function weekday(value) {
  const date = new Date(value + "T12:00:00");
  return Number.isNaN(date.getTime()) ? "" : date.getDay() || 7;
}

function fixDay() {
  const date = $("att_date"), day = $("att_day");
  if (!date || !day || date.dataset.fixed) return;
  date.dataset.fixed = "1";
  day.readOnly = true;
  day.max = 7;
  const refresh = () => { day.value = weekday(date.value); };
  date.addEventListener("change", refresh);
  date.addEventListener("input", refresh);
  refresh();
}

function currentStaff() {
  const selectedId = Number($("sharedStaffSelect")?.value || 0);
  return staff.find((item) => item.active && Number(item.id) === selectedId)
    || staff.find((item) => item.active && (String(item.user_id || "") === String(user?.id || "") || String(item.email || "").toLowerCase() === String(user?.email || "").toLowerCase()))
    || null;
}

function panels() {
  const host = $("packageOperations") || document.querySelector('[data-panel="packages"]');
  if (!host || $("pkgVisitPanel")) return;
  host.insertAdjacentHTML("beforeend", `
    <div id="pkgVisitPanel">
      <div class="page-head" style="margin-top:0"><div><div class="page-title">Багцтай үйлчлүүлэгч</div><div class="page-sub">Нэрээр хайж, үйлчлүүлэгч дээр дараад багцын дэлгэрэнгүй болон ашиглалтыг бүртгэнэ</div></div></div>
      <div class="panel">
        <div class="field"><label for="pkgCustomerSearch">Үйлчлүүлэгчийн нэрээр хайх</label><input class="ctl" id="pkgCustomerSearch" type="search" placeholder="Нэр эсвэл багцын нэр бичнэ үү" autocomplete="off"/></div>
        <div class="package-customer-list" id="pkgCustomerList"></div>
      </div>
      <div id="pkgCustomerDetail" style="display:none">
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title" id="pkgDetailName"></div><div class="page-sub" id="pkgDetailMeta"></div></div></div>
          <div class="kpis package-detail-kpis" id="pkgDetailKpis"></div>
          <div class="form-grid" style="margin-top:18px"><div class="field"><label for="pkgVisitDate">Орсон өдөр *</label><input class="ctl" id="pkgVisitDate" type="date"></div><div class="field"><label for="pkgVisitNotes">Тэмдэглэл</label><input class="ctl" id="pkgVisitNotes" maxlength="500" placeholder="Жишээ: өглөөний ээлж"></div></div>
          <div class="field" style="margin-top:14px"><label>Өнөөдөр ашигласан төхөөрөмжүүд *</label><div class="staff-check-grid" id="pkgVisitServices"></div></div>
          <div class="page-sub" id="pkgVisitStaff" style="margin-top:12px"></div><div class="form-actions"><button class="btn-sm primary" id="pkgVisitSave">Ашиглалтыг бүртгэх</button></div>
        </div>
        <div class="panel" style="padding:0;overflow:hidden"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Огноо</th><th>Үйлчилгээ</th><th>Тоо</th><th>Ажилтан</th><th>Тэмдэглэл</th></tr></thead><tbody id="pkgVisitBody"></tbody></table></div></div>
      </div>
    </div>
    <div id="pkgLeadPanel">
      <div class="page-head" style="margin-top:26px"><div><div class="page-title">Багцын борлуулалт</div><div class="page-sub">Бүртгэсэн төлбөр өдрийн борлуулалтад орно</div></div></div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Багцын борлуулалт бүртгэх</div></div>
        <div class="form-grid">
          <div class="field"><label for="pkgSaleDate">Огноо *</label><input class="ctl" type="date" id="pkgSaleDate"></div>
          <div class="field"><label for="pkgSaleSearch">Үйлчлүүлэгч хайх</label><input class="ctl" type="search" id="pkgSaleSearch" placeholder="Нэр / латин галиг / утас" autocomplete="off"></div>
          <div class="field"><label for="pkgLeadCustomer">Үйлчлүүлэгч *</label><select class="ctl" id="pkgLeadCustomer"></select></div>
          <div class="field"><label for="pkgLeadPurchased">Багц *</label><select class="ctl" id="pkgLeadPurchased"></select></div>
          <div class="field"><label for="pkgSalePrice">Багцын үнэ</label><input class="ctl" id="pkgSalePrice" readonly value="—"></div>
        </div>
        <div class="form-sub">Төлбөр</div>
        <div class="form-grid">
          <div class="field"><label for="pkgSaleBank">Төлбөр хүлээн авах банк / хэлбэр *</label><select class="ctl" id="pkgSaleBank"><option value="">Сонгох</option><option value="golomt">Голомт</option><option value="khan">Хаан</option><option value="cash">Бэлэн</option><option value="invoice">Нэхэмжлэх</option><option value="barter">Barter</option></select></div>
          <div class="field"><label for="pkgSaleAmount">Бүртгэх дүн *</label><input class="ctl" type="number" min="1" step="1" id="pkgSaleAmount"></div>
          <div class="field"><label for="pkgLeadNotes">Тэмдэглэл</label><input class="ctl" id="pkgLeadNotes" maxlength="1000"></div>
        </div>
        <div class="page-sub" id="pkgLeadStaff" style="margin-top:12px"></div><div class="form-actions"><button class="btn-sm primary" id="pkgLeadSave">Борлуулалт бүртгэх</button><span class="page-sub" id="pkgSaleStatus" role="status"></span></div>
      </div>
      <details><summary>Өмнөх багцын худалдан авалт, сонирхлын бүртгэл</summary>
      <div class="panel" style="padding:0;overflow:hidden"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Огноо</th><th>Үйлчлүүлэгч</th><th>Авсан багц</th><th>Авах төлөвтэй</th><th>Ажилтан</th><th>Тэмдэглэл</th></tr></thead><tbody id="pkgLeadBody"></tbody></table></div></div>
      </details>
    </div>`);
  $("packageSalesOperations")?.appendChild($("pkgLeadPanel"));
  $("pkgVisitDate").value = todayKey();
  $("pkgSaleDate").value = todayKey();
  $("pkgSaleSearch").addEventListener("input", renderSaleCustomers);
  $("pkgLeadPurchased").addEventListener("change", () => {
    const selected = packages.find(item => String(item.id) === $("pkgLeadPurchased").value);
    $("pkgSalePrice").value = selected ? money(selected.price) : '—';
    $("pkgSaleAmount").value = selected ? selected.price : '';
  });
  $("pkgCustomerSearch").addEventListener("input", (event) => {
    packageSearch = event.target.value.trim().toLowerCase();
    renderPackageCustomers();
  });
}

function used(contractId) {
  return redemptions.filter((item) => Number(item.contract_id) === Number(contractId)).reduce((sum, item) => sum + Number(item.units || 0), 0);
}

function activeContracts() {
  return contracts.filter((contract) => !["expired", "cancelled"].includes(contract.status));
}

function renderPackageCustomers() {
  const host = $("pkgCustomerList");
  if (!host) return;
  const rows = activeContracts().filter((contract) => matchesName(`${contract.customer_label || ""} ${contract.package_label || ""}`, packageSearch));
  host.innerHTML = rows.length ? rows.map((contract) => {
    const total = contract.total_units == null ? null : Number(contract.total_units), spent = used(contract.id);
    const left = total == null ? "Үлдэгдэл тодорхойгүй" : `${Math.max(0, total - spent)} үлдсэн`;
    return `<button type="button" class="package-customer-card${Number(selectedContractId) === Number(contract.id) ? " on" : ""}" data-contract-id="${contract.id}"><span><b>${safe(contract.customer_label || "Нэргүй")}</b><small>${safe(contract.package_label || "Багц")}</small></span><strong>${safe(left)}</strong></button>`;
  }).join("") : '<div class="empty">Хайлтад тохирох багцтай үйлчлүүлэгч олдсонгүй.</div>';
  host.querySelectorAll("[data-contract-id]").forEach((button) => button.addEventListener("click", () => {
    selectedContractId = Number(button.dataset.contractId);
    renderPackageCustomers();
    renderSelectedPackage();
  }));
}

function renderSelectedPackage() {
  const detail = $("pkgCustomerDetail");
  const contract = contracts.find((item) => Number(item.id) === Number(selectedContractId));
  if (!detail || !contract) {
    if (detail) detail.style.display = "none";
    return;
  }
  detail.style.display = "";
  const history = redemptions.filter((item) => Number(item.contract_id) === Number(contract.id)).sort((a, b) => String(b.used_on).localeCompare(String(a.used_on)) || Number(b.id) - Number(a.id));
  const spent = history.reduce((sum, item) => sum + Number(item.units || 0), 0);
  const total = contract.total_units == null ? null : Number(contract.total_units);
  const left = total == null ? null : Math.max(0, total - spent);
  $("pkgDetailName").textContent = contract.customer_label || "Нэргүй үйлчлүүлэгч";
  $("pkgDetailMeta").textContent = `${contract.package_label || "Багц"} · ${contract.purchased_on || "Эхэлсэн огноогүй"}${contract.expires_on ? ` → ${contract.expires_on}` : ""}`;
  $("pkgDetailKpis").innerHTML = [["Авсан багц", contract.package_label || "—", contract.status || "—"], ["Нийт орох эрх", total == null ? "—" : total, "үйлчилгээ"], ["Орсон", spent, `${history.length} бүртгэл`], ["Үлдсэн", left == null ? "—" : left, "үйлчилгээ"]].map(([label, value, note]) => `<div class="kpi"><div class="kpi-label">${safe(label)}</div><div class="kpi-value">${safe(value)}</div><div class="kpi-note">${safe(note)}</div></div>`).join("");
  $("pkgVisitBody").innerHTML = history.length ? history.map((item) => {
    const employee = staff.find((person) => Number(person.id) === Number(item.staff_id));
    return `<tr><td class="t-mono">${safe(item.used_on)}</td><td class="t-strong">${safe(item.service_label || "—")}</td><td>${safe(item.units || 1)}</td><td>${safe(employee?.name || "—")}</td><td>${safe(item.notes || "—")}</td></tr>`;
  }).join("") : '<tr><td colspan="5"><div class="empty">Энэ багцын ашиглалтын түүх алга.</div></td></tr>';
  const employee = currentStaff();
  $("pkgVisitStaff").textContent = employee ? `Бүртгэх ажилтан: ${employee.name}` : "Хажуугийн хэсгээс бүртгэх ажилтны нэрийг сонгоно уу";
}

function renderSaleCustomers() {
  const customer = $("pkgLeadCustomer");
  if (!customer) return;
  const selected = customer.value;
  const query = $("pkgSaleSearch").value.trim();
  const rows = customers.filter(item => matchesName(item.full_name, query) || (query && String(item.phone || '').includes(query)));
  customer.innerHTML = `<option value="">${rows.length ? 'Үйлчлүүлэгч сонгох' : 'Үйлчлүүлэгч олдсонгүй'}</option>` + rows.map((item) => `<option value="${item.id}">${safe(item.full_name)} · ${safe(item.phone || "утасгүй")}</option>`).join("");
  customer.value = rows.some(item => String(item.id) === selected) ? selected : '';
}

function options() {
  renderSaleCustomers();
  const selectedPackage = $("pkgLeadPurchased").value;
  const packageOptions = '<option value="">Сонгоогүй</option>' + packages.map((item) => `<option value="${item.id}">${safe(item.name)}</option>`).join("");
  $("pkgLeadPurchased").innerHTML = packageOptions;
  $("pkgLeadPurchased").value = selectedPackage;
  $("pkgVisitServices").innerHTML = services.map((item) => `<label class="staff-check"><input type="checkbox" value="${item.id}"><span>${safe(item.name)}</span></label>`).join("");
  const employee = currentStaff();
  $("pkgLeadStaff").textContent = employee ? `Бүртгэх ажилтан: ${employee.name}` : "Хажуугийн хэсгээс бүртгэх ажилтны нэрийг сонгоно уу";
  renderPackageCustomers();
  renderSelectedPackage();
}

function renderLeads() {
  const employee = currentStaff(), admin = ["owner", "admin"].includes(profile.role);
  const rows = admin ? leads : leads.filter((item) => Number(item.staff_id) === Number(employee?.id));
  $("pkgLeadBody").innerHTML = rows.length ? rows.map((item) => `<tr><td>${new Date(item.created_at).toLocaleDateString("mn-MN")}</td><td class="t-strong">${safe(item.customer_label)}</td><td>${safe(item.purchased_package_label || "—")}</td><td>${safe(item.intended_package_label || "—")}</td><td>${safe(item.staff_name)}</td><td>${safe(item.notes || "—")}</td></tr>`).join("") : '<tr><td colspan="6"><div class="empty">Багцын бүртгэл алга.</div></td></tr>';
}

async function allRows(build) {
  const data = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await build().range(offset, offset + 999);
    if (result.error) return result;
    data.push(...result.data);
    if (result.data.length < 1000) return { data, error: null };
  }
}

async function load() {
  const session = (await sb.auth.getSession()).data.session;
  if (!session) return;
  user = session.user;
  const result = await Promise.all([
    allRows(() => sb.from("customers").select("id,full_name,phone").order("full_name").order("id")),
    sb.from("packages").select("id,name,price").is("archived_at", null).eq("active", true).order("sort"),
    sb.from("staff").select("id,name,email,user_id,active").eq("active", true).order("sort"),
    sb.from("package_sales_leads").select("*").order("created_at", { ascending: false }),
    sb.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    allRows(() => sb.from("customer_package_contracts").select("id,customer_id,customer_label,package_label,total_units,status,purchased_on,expires_on,notes").order("customer_label").order("id")),
    allRows(() => sb.from("package_redemptions").select("id,contract_id,used_on,units,service_id,service_label,staff_id,notes,created_at").order("used_on", { ascending: false }).order("id")),
    sb.from("services").select("id,name,active,category").eq("active", true).neq("category", "legacy-import").order("sort"),
  ]);
  if (result.some(item => item.error)) {
    $("pkgSaleStatus").textContent = "Мэдээлэл ачаалж чадсангүй. Хуудсаа дахин ачаална уу.";
    $("pkgLeadSave").disabled = true;
    $("pkgVisitSave").disabled = true;
    return;
  }
  $("pkgLeadSave").disabled = false;
  $("pkgVisitSave").disabled = false;
  customers = result[0].data || []; packages = result[1].data || []; staff = result[2].data || []; leads = result[3].data || [];
  profile = result[4].data || {}; contracts = result[5].data || []; redemptions = result[6].data || []; services = result[7].data || [];
  options();
  renderLeads();
}

async function saveVisit() {
  const contract = contracts.find((item) => Number(item.id) === Number(selectedContractId));
  const employee = currentStaff(), date = $("pkgVisitDate").value;
  const selected = [...$("pkgVisitServices").querySelectorAll("input:checked")].map((input) => services.find((item) => String(item.id) === input.value)).filter(Boolean);
  if (!contract) return alert("Багцтай үйлчлүүлэгчээ сонгоно уу.");
  if (!date) return alert("Орсон өдрийг сонгоно уу.");
  if (!selected.length) return alert("Ашигласан төхөөрөмжөөс дор хаяж нэгийг сонгоно уу.");
  if (!employee) return alert("Бүртгэх ажилтны нэрийг сонгоно уу.");
  const remaining = contract.total_units == null ? null : Math.max(0, Number(contract.total_units) - used(contract.id));
  if (remaining != null && selected.length > remaining) return alert(`Энэ багцад ${remaining} эрх үлдсэн байна.`);
  const button = $("pkgVisitSave"); button.disabled = true;
  const note = $("pkgVisitNotes").value.trim() || null;
  const { data, error } = await sb.from("package_redemptions").insert(selected.map((service) => ({ contract_id: contract.id, used_on: date, units: 1, service_id: service.id, service_label: service.name, staff_id: employee.id, notes: note }))).select();
  button.disabled = false;
  if (error) return alert("Багцын ашиглалт хадгалж чадсангүй: " + error.message);
  redemptions.unshift(...(data || []));
  $("pkgVisitNotes").value = "";
  $("pkgVisitServices").querySelectorAll("input").forEach((input) => { input.checked = false; });
  renderPackageCustomers(); renderSelectedPackage();
}

async function saveLead() {
  const customer = customers.find((item) => String(item.id) === $("pkgLeadCustomer").value);
  const purchased = packages.find((item) => String(item.id) === $("pkgLeadPurchased").value);
  const employee = currentStaff();
  if (!customer) return alert("Үйлчлүүлэгчээ сонгоно уу.");
  if (!purchased) return alert("Багцаа сонгоно уу.");
  const bank = $("pkgSaleBank").value, amount = Number($("pkgSaleAmount").value), date = $("pkgSaleDate").value;
  if (!date || !['golomt','khan','cash','invoice','barter'].includes(bank) || !Number.isSafeInteger(amount) || amount <= 0) return alert("Огноо, төлбөрийн банк болон зөв дүн оруулна уу.");
  if (!employee && !["owner", "admin"].includes(profile.role)) return alert("Бүртгэх ажилтны нэрийг сонгоно уу.");
  const button = $("pkgLeadSave");
  if (button.disabled) return;
  button.disabled = true;
  try {
    const { data, error } = await sb.from("sales").insert({ sale_date: date, customer_id: customer.id, customer_name: customer.full_name, phone: customer.phone || null, services: `Багц: ${purchased.name}`, staff_id: employee?.id || null, therapist: employee?.name || null, [bank]: amount, source: 'manual', created_by: user.id, needs_review: false, note: $("pkgLeadNotes").value.trim() || null }).select().single();
    if (error) throw error;
    window.dispatchEvent(new CustomEvent('cryo:sale-saved', { detail: data }));
    ['pkgLeadCustomer','pkgLeadPurchased','pkgLeadNotes','pkgSaleSearch','pkgSaleBank','pkgSaleAmount'].forEach(id => { $(id).value = ''; });
    $("pkgSalePrice").value = '—';
    $("pkgSaleStatus").textContent = `Борлуулалт бүртгэгдлээ · ${money(amount)}`;
    renderSaleCustomers();
  } catch (error) {
    alert("Борлуулалт хадгалж чадсангүй: " + error.message);
  } finally { button.disabled = false; }
}

document.addEventListener("DOMContentLoaded", () => {
  panels(); fixDay();
  $("pkgLeadSave").addEventListener("click", saveLead);
  $("pkgVisitSave").addEventListener("click", saveVisit);
  $("sharedStaffSelect")?.addEventListener("change", () => { options(); renderLeads(); });
  window.addEventListener("cryo:staff-changed", () => { options(); renderLeads(); });
  sb.auth.onAuthStateChange((_event, session) => session && setTimeout(load, 0));
  load();
});
