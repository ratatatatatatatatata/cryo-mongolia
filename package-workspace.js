import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

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
      <div class="page-head" style="margin-top:26px"><div><div class="page-title">Багцын худалдан авалт, сонирхол</div><div class="page-sub">Үйлчлүүлэгчийн авсан болон дараа авах төлөвтэй багцыг бүртгэнэ</div></div></div>
      <div class="panel"><div class="form-grid"><div class="field"><label>Үйлчлүүлэгч *</label><select class="ctl" id="pkgLeadCustomer"></select></div><div class="field"><label>Авсан багц</label><select class="ctl" id="pkgLeadPurchased"></select></div><div class="field"><label>Авах төлөвтэй багц</label><select class="ctl" id="pkgLeadIntended"></select></div><div class="field"><label>Тэмдэглэл</label><input class="ctl" id="pkgLeadNotes" maxlength="1000" placeholder="Хэзээ авах, ямар хэрэгцээтэй зэрэг"></div></div><div class="page-sub" id="pkgLeadStaff" style="margin-top:12px"></div><div class="form-actions"><button class="btn-sm primary" id="pkgLeadSave">Багцын мэдээлэл хадгалах</button></div></div>
      <div class="panel" style="padding:0;overflow:hidden"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Огноо</th><th>Үйлчлүүлэгч</th><th>Авсан багц</th><th>Авах төлөвтэй</th><th>Ажилтан</th><th>Тэмдэглэл</th></tr></thead><tbody id="pkgLeadBody"></tbody></table></div></div>
    </div>`);
  $("pkgVisitDate").value = todayKey();
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
  const rows = activeContracts().filter((contract) => !packageSearch || `${contract.customer_label || ""} ${contract.package_label || ""}`.toLowerCase().includes(packageSearch));
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

function options() {
  const customer = $("pkgLeadCustomer");
  if (!customer) return;
  customer.innerHTML = '<option value="">Үйлчлүүлэгч сонгох</option>' + customers.map((item) => `<option value="${item.id}">${safe(item.full_name)} · ${safe(item.phone || "утасгүй")}</option>`).join("");
  const packageOptions = '<option value="">Сонгоогүй</option>' + packages.map((item) => `<option value="${item.id}">${safe(item.name)}</option>`).join("");
  $("pkgLeadPurchased").innerHTML = packageOptions;
  $("pkgLeadIntended").innerHTML = packageOptions;
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

async function load() {
  const session = (await sb.auth.getSession()).data.session;
  if (!session) return;
  user = session.user;
  const result = await Promise.all([
    sb.from("customers").select("id,full_name,phone").order("full_name"),
    sb.from("packages").select("id,name").is("archived_at", null).order("sort"),
    sb.from("staff").select("id,name,email,user_id,active").eq("active", true).order("sort"),
    sb.from("package_sales_leads").select("*").order("created_at", { ascending: false }),
    sb.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    sb.from("customer_package_contracts").select("id,customer_id,customer_label,package_label,total_units,status,purchased_on,expires_on,notes").order("customer_label"),
    sb.from("package_redemptions").select("id,contract_id,used_on,units,service_id,service_label,staff_id,notes,created_at").order("used_on", { ascending: false }),
    sb.from("services").select("id,name,active,category").eq("active", true).neq("category", "legacy-import").order("sort"),
  ]);
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
  const intended = packages.find((item) => String(item.id) === $("pkgLeadIntended").value);
  const employee = currentStaff();
  if (!customer) return alert("Үйлчлүүлэгчээ сонгоно уу.");
  if (!purchased && !intended) return alert("Авсан эсвэл авах төлөвтэй багцаас нэгийг сонгоно уу.");
  if (!employee && !["owner", "admin"].includes(profile.role)) return alert("Бүртгэх ажилтны нэрийг сонгоно уу.");
  const button = $("pkgLeadSave"); button.disabled = true;
  const { data, error } = await sb.from("package_sales_leads").insert({ customer_id: customer.id, customer_label: customer.full_name, purchased_package_id: purchased?.id || null, purchased_package_label: purchased?.name || null, intended_package_id: intended?.id || null, intended_package_label: intended?.name || null, staff_id: employee?.id || null, staff_name: employee?.name || user.email, notes: $("pkgLeadNotes").value.trim() || null }).select().single();
  button.disabled = false;
  if (error) return alert("Хадгалж чадсангүй: " + error.message);
  leads.unshift(data);
  ["pkgLeadCustomer", "pkgLeadPurchased", "pkgLeadIntended", "pkgLeadNotes"].forEach((id) => { $(id).value = ""; });
  renderLeads();
}

document.addEventListener("DOMContentLoaded", () => {
  panels(); fixDay();
  $("pkgLeadSave").addEventListener("click", saveLead);
  $("pkgVisitSave").addEventListener("click", saveVisit);
  $("sharedStaffSelect")?.addEventListener("change", () => { options(); renderLeads(); });
  sb.auth.onAuthStateChange((_event, session) => session && setTimeout(load, 0));
  load();
});
