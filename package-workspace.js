import { packageCustomerGroups, packageState } from "./package-customers.js";
import { customerPicker } from "./customer-picker.js";
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
let packageRequestId = crypto.randomUUID();
let loadedUserId = null;
let selectedCustomerKey = null;
let accountSales=[], accountEvents=[], checkoutBooking=null;
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
        <div class="field"><label for="pkgCustomerSearch">Үйлчлүүлэгчийн нэрээр хайх</label><input class="ctl" id="pkgCustomerSearch" type="search" placeholder="Нэр эсвэл утасны дугаар" autocomplete="off"/></div>
        <div class="package-customer-list" id="pkgCustomerList"></div>
      </div>
      <div id="pkgCustomerDetail" style="display:none">
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title" id="pkgDetailName"></div><div class="page-sub" id="pkgDetailMeta"></div><p class="record-note" id="pkgDetailNotes"></p></div></div>
          <div class="kpis package-detail-kpis" id="pkgDetailKpis"></div>
          <div class="form-grid" style="margin-top:18px"><div class="field"><label for="pkgVisitDate">Орсон өдөр *</label><input class="ctl" id="pkgVisitDate" type="date"></div><div class="field"><label for="pkgVisitNotes">Тэмдэглэл</label><input class="ctl" id="pkgVisitNotes" maxlength="500" placeholder="Жишээ: өглөөний ээлж"></div></div>
          <div class="field" style="margin-top:14px"><label>Өнөөдөр ашигласан төхөөрөмжүүд *</label><div class="staff-check-grid" id="pkgVisitServices"></div></div>
          <div class="page-sub" id="pkgVisitStaff" style="margin-top:12px"></div><div class="form-actions"><button class="btn-sm primary" id="pkgVisitSave">Ашиглалтыг бүртгэх</button></div>
        </div>
        <div class="panel" style="padding:0;overflow:hidden"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Огноо</th><th>Үйлчилгээ</th><th>Тоо</th><th>Ажилтан</th><th>Тэмдэглэл</th></tr></thead><tbody id="pkgVisitBody"></tbody></table></div></div>
      </div>
    </div>
    <div id="pkgLeadPanel">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Багцын борлуулалт бүртгэх</div></div>
        <div class="form-grid">
          <div class="field"><label for="pkgSaleDate">Огноо *</label><input class="ctl" type="date" id="pkgSaleDate"></div>
          <div class="field"><label for="pkgSaleSearch">Үйлчлүүлэгч хайх</label><input class="ctl" type="search" id="pkgSaleSearch" placeholder="Нэр / латин галиг / утас" autocomplete="off"></div>
          <div class="field"><label for="pkgLeadCustomer">Үйлчлүүлэгч *</label><select class="ctl" id="pkgLeadCustomer"></select></div>
          <div class="field"><label for="pkgLeadPurchased">Багц *</label><select class="ctl" id="pkgLeadPurchased"></select></div>
          <div class="field"><label for="pkgSalePrice">Багцын үнэ</label><input class="ctl" id="pkgSalePrice" readonly value="—"></div>
        </div>
        <div id="pkgCustomForm" hidden>
          <div class="form-sub">Багц үүсгэх</div>
          <div class="field"><label for="pkgCustomName">Багцын нэр *</label><input class="ctl" id="pkgCustomName" maxlength="120" placeholder="Жишээ: Сэргээх 10 оролт"></div>
          <div class="form-grid" id="pkgCustomDevices" style="margin-top:14px"></div>
          <div class="form-grid" style="margin-top:14px">
            <div class="field"><label for="pkgCustomBase">Үндсэн үнэ (₮) *</label><input class="ctl" id="pkgCustomBase" type="number" min="1" step="1"></div>
            <div class="field"><label for="pkgCustomDiscount">Хөнгөлөлт (%)</label><input class="ctl" id="pkgCustomDiscount" type="number" min="0" max="100" step="0.01" value="0"></div>
          </div>
          <p class="page-sub" id="pkgCustomSummary" role="status"></p>
        </div>
        <div class="form-sub">Төлбөр</div>
        <div class="form-grid">
          <div class="field"><label for="pkgSaleBank">Төлбөр хүлээн авах банк / хэлбэр *</label><select class="ctl" id="pkgSaleBank"><option value="">Сонгох</option><option value="golomt">Голомт</option><option value="khan">Хаан</option><option value="cash">Бэлэн</option><option value="invoice">Нэхэмжлэх</option><option value="barter">Barter</option></select></div>
          <div class="field"><label for="pkgSaleAmount">Бүртгэх дүн *</label><input class="ctl" type="number" min="1" step="1" id="pkgSaleAmount"></div>
          <div class="field"><label for="pkgLeadNotes">Тэмдэглэл</label><input class="ctl" id="pkgLeadNotes" maxlength="1000"></div>
        </div>
        <div class="page-sub" id="pkgLeadStaff" style="margin-top:12px"></div><div class="form-actions"><button class="btn-sm primary" id="pkgLeadSave">Борлуулалт бүртгэх</button><button class="btn-sm ghost" id="pkgSaleCancel">Болих</button><span class="page-sub" id="pkgSaleStatus" role="status"></span></div>
      </div>
      <details><summary>Өмнөх багцын худалдан авалт, сонирхлын бүртгэл</summary>
      <div class="panel" style="padding:0;overflow:hidden"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Огноо</th><th>Үйлчлүүлэгч</th><th>Авсан багц</th><th>Авах төлөвтэй</th><th>Ажилтан</th><th>Тэмдэглэл</th></tr></thead><tbody id="pkgLeadBody"></tbody></table></div></div>
      </details>
    </div>`);
  $("packageSalesOperations")?.appendChild($("pkgLeadPanel"));
  $('pkgSaleBank').add(new Option('Дотоод (орлогод нэмэгдэхгүй)','internal'));
  $('pkgSaleAmount').min='0';
  $('pkgSaleAmount').insertAdjacentHTML('afterend','<small>Хэсэгчлэн төлөх бол зөвхөн энэ удаа төлсөн дүнгээ оруулна. Үлдэгдлийг багцын дэлгэрэнгүйгээс төлнө.</small><p id="pkgPaymentBalance" class="page-sub"></p>');
  const updateBalance=()=>{const pkg=packages.find(p=>String(p.id)===$('pkgLeadPurchased').value);$('pkgPaymentBalance').textContent=pkg?`Үлдэгдэл: ${money(Number(pkg.price)-Number($('pkgSaleAmount').value||0))}`:'';};
  $('pkgSaleAmount').addEventListener('input',updateBalance);$('pkgLeadPurchased').addEventListener('change',()=>setTimeout(updateBalance,0));
  $('pkgCustomForm').insertAdjacentHTML('beforeend','<p class="page-sub">Энд зөвхөн багцын загвар үүсгэнэ. Үйлчлүүлэгч, төлбөр шаардахгүй.</p>');
  $('pkgLeadPanel').insertAdjacentHTML('afterbegin','<div class="panel" id="pkgBookingLink" hidden><p id="pkgBookingLabel"></p><div class="field"><label for="pkgExistingContract">Авсан багцаа ашиглах — дахин төлбөр авахгүй</label><select class="ctl" id="pkgExistingContract"></select></div><button class="btn-sm primary" id="pkgLinkBooking">Захиалгыг багцтай холбох</button><p class="page-sub">Шинээр авах бол доорх багцын борлуулалтыг бөглөнө. Ашигласан оролтыг үйлчлүүлсэн өдөр нь багцын дэлгэрэнгүйд бүртгэнэ.</p></div>');
  $('pkgLinkBooking').onclick=async()=>{const button=$('pkgLinkBooking');if(button.disabled||!checkoutBooking)return;button.disabled=true;try{const r=await sb.rpc('package_checkout',{p:{action:'link',request_id:packageRequestId,contract_id:Number($('pkgExistingContract').value),booking_id:checkoutBooking.id,staff_id:currentStaff()?.id||null}});if(r.error)throw r.error;window.dispatchEvent(new CustomEvent('cryo:booking-updated',{detail:r.data.booking}));packageRequestId=crypto.randomUUID();checkoutBooking=null;setPackageSaleOpen(false);alert('Захиалга багцтай холбогдлоо. Давхар төлбөр авахгүй.');}catch(e){alert(e.message);}finally{button.disabled=false;}};
  const templateButton=document.createElement('button');templateButton.className='btn-sm ghost';templateButton.textContent='+ Багцын загвар үүсгэх';templateButton.type='button';$('repPackageSales')?.after(templateButton);
  templateButton.onclick=()=>{checkoutBooking=null;setPackageSaleOpen(true);$('pkgLeadPurchased').value='custom';$('pkgLeadPurchased').dispatchEvent(new Event('change'));$('pkgCustomName').focus();};
  window.addEventListener('cryo:package-checkout',async({detail})=>{await load();checkoutBooking=detail;setPackageSaleOpen(true);$('pkgLeadPurchased').value='';$('pkgLeadPurchased').dispatchEvent(new Event('change'));$('pkgSaleSearch').value=detail.customer_name;renderSaleCustomers();const customer=customers.find(c=>c.full_name===detail.customer_name && (!detail.phone||c.phone===detail.phone))||customers.find(c=>c.full_name===detail.customer_name);$('pkgLeadCustomer').value=customer?String(customer.id):'';$('pkgBookingLabel').textContent=`Захиалга: ${detail.ref} · ${detail.customer_name}`;$('pkgExistingContract').innerHTML='<option value="">Багц сонгох</option>'+activeContracts().filter(c=>c.customer_label===detail.customer_name).map(c=>`<option value="${c.id}">${safe(c.package_label)} · ${c.id}</option>`).join('');$('pkgBookingLink').hidden=false;});
  $("repPackageSales")?.addEventListener("click", () => {
    checkoutBooking=null;
    $('pkgLeadPurchased').value='';$('pkgLeadPurchased').dispatchEvent(new Event('change'));
    if ($("packageSaleNotice")) $("packageSaleNotice").textContent = '';
    setPackageSaleOpen(true);
    $("pkgSaleSearch").focus();
  });
  $("pkgSaleCancel").addEventListener("click", () => {
    setPackageSaleOpen(false);
    $("repPackageSales")?.focus();
  });
  $("repSales")?.addEventListener("click", () => setPackageSaleOpen(false));
  $("pkgVisitDate").value = todayKey();
  $("pkgSaleDate").value = todayKey();
  $("pkgSaleSearch").addEventListener("input", renderSaleCustomers);
  $("pkgLeadPurchased").addEventListener("change", () => {
    const custom = $("pkgLeadPurchased").value === 'custom';
    $("pkgCustomForm").hidden = !custom;
    $("pkgSaleAmount").readOnly = false;
    ['pkgLeadCustomer','pkgSaleSearch','pkgSaleDate','pkgSaleBank','pkgSaleAmount','pkgLeadNotes'].forEach(id=>$(id).closest('.field').hidden=custom);
    $('pkgLeadSave').textContent=custom?'Багцын загвар хадгалах':'Борлуулалт бүртгэх';
    if (custom) return updateCustomPackagePrice();
    const selected = packages.find(item => String(item.id) === $("pkgLeadPurchased").value);
    $("pkgSalePrice").value = selected ? money(selected.price) : '—';
    $("pkgSaleAmount").value = selected ? selected.price : '';
  });
  ['pkgCustomBase','pkgCustomDiscount'].forEach(id => $(id).addEventListener('input', updateCustomPackagePrice));
  $("pkgCustomerSearch").addEventListener("input", (event) => {
    packageSearch = event.target.value.trim().toLowerCase();
    selectedCustomerKey=null;selectedContractId=null;renderSelectedPackage();
    renderPackageCustomers();
  });
}

function customPackageItems() {
  return [...$("pkgCustomDevices").querySelectorAll('input')].filter(input => Number(input.value)>0)
    .map(input => ({ service_id:Number(input.dataset.serviceId), units:Number(input.value) }));
}

function updateCustomPackagePrice() {
  const base=Number($("pkgCustomBase").value), discount=Number($("pkgCustomDiscount").value);
  const valid=Number.isSafeInteger(base) && base>0 && Number.isFinite(discount) && discount>=0 && discount<=100;
  const due=valid ? Math.round(base*(100-Math.round(discount*100)/100)/100) : null;
  $("pkgSalePrice").value=due==null ? '—' : money(due);
  $("pkgSaleAmount").value=due==null ? '' : due;
  $("pkgCustomSummary").textContent=due==null ? 'Үндсэн үнэ болон 0–100% хөнгөлөлт оруулна уу.' : `Хөнгөлөлт: ${money(base-due)} · Одоо төлөх: ${money(due)}`;
}

function setPackageSaleOpen(open) {
  const host = $("packageSalesOperations");
  if (host) host.hidden = !open;
  $("repPackageSales")?.setAttribute('aria-expanded', String(open));
  if($('pkgBookingLink')) $('pkgBookingLink').hidden=!open||!checkoutBooking;
}

function used(contractId) {
  return redemptions.filter((item) => Number(item.contract_id) === Number(contractId)).reduce((sum, item) => sum + Number(item.units || 0), 0);
}

function activeContracts() {
  return contracts.filter(contract=>contract.status!=="cancelled" && packageState(contract,used(contract.id),todayKey())==="active");
}

function renderPackageCustomers() {
  const host=$("pkgCustomerList");if(!host)return;
  const groups=packageCustomerGroups(contracts,customers);
  const rows=groups.filter(person=>matchesName(person.name,packageSearch)||(packageSearch&&person.phone.replace(/\s/g,'').includes(packageSearch.replace(/\s/g,''))));
  host.innerHTML=rows.length?rows.map(person=>`<button type="button" class="package-customer-card${selectedCustomerKey===person.key?' on':''}" data-customer-key="${safe(person.key)}" aria-expanded="${selectedCustomerKey===person.key}"><span><b>${safe(person.name)}</b><small>${safe(person.phone||'Утас бүртгээгүй')}${person.ambiguous?' · Ижил нэртэй бүртгэл — холболтыг шалгана уу':''}</small></span></button>`).join(''):'<div class="empty">Үйлчлүүлэгч олдсонгүй.</div>';
  host.querySelectorAll('[data-customer-key]').forEach(button=>button.onclick=()=>{selectedCustomerKey=button.dataset.customerKey;selectedContractId=null;renderPackageCustomers();renderSelectedPackage();});
  let panel=$('pkgCustomerPackages');if(!panel){panel=document.createElement('div');panel.id='pkgCustomerPackages';panel.className='panel';host.after(panel);}
  const person=groups.find(row=>row.key===selectedCustomerKey);panel.hidden=!person;if(!person){panel.replaceChildren();return;}
  const items=person.contracts.map(contract=>({contract,state:packageState(contract,used(contract.id),todayKey())}));
  const section=(title,items)=>`<h4>${title} (${items.length})</h4><div class="package-customer-list">${items.length?items.sort((a,b)=>String(b.contract.purchased_on||'').localeCompare(String(a.contract.purchased_on||''))||b.contract.id-a.contract.id).map(({contract,state})=>`<button type="button" class="package-customer-card${Number(selectedContractId)===Number(contract.id)?' on':''}" data-contract-id="${contract.id}"><span><b>${safe(contract.package_label||'Багц')}</b><small>${safe(contract.purchased_on||'Огноогүй')} · ${state==='active'?'Идэвхтэй':state==='expired'?'Хугацаа дууссан':'Дууссан'}</small></span><strong>${contract.total_units==null?'Үлдэгдэл тодорхойгүй':Math.max(0,Number(contract.total_units)-used(contract.id))+' үлдсэн'}</strong></button>`).join(''):'<p class="page-sub">Багц байхгүй.</p>'}</div>`;
  panel.innerHTML=`<h3>${safe(person.name)} · ${safe(person.phone||'Утас бүртгээгүй')}</h3>`+section('Идэвхтэй багцууд',items.filter(item=>item.state==='active'))+section('Дууссан багцууд',items.filter(item=>item.state!=='active'));
  panel.querySelectorAll('[data-contract-id]').forEach(button=>button.onclick=()=>{selectedContractId=Number(button.dataset.contractId);renderPackageCustomers();renderSelectedPackage();});
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
  $("pkgDetailNotes").textContent=contract.notes ? `Тэмдэглэл: ${contract.notes}` : "";
  const closed=packageState(contract,spent,todayKey())!=='active';
  $("pkgVisitSave").disabled=closed;
  const items=contract.service_units || [];
  $("pkgVisitServices").innerHTML=(items.length ? items.map(item => {
    const spent=history.filter(row => Number(row.service_id)===Number(item.service_id)).reduce((sum,row)=>sum+Number(row.units),0);
    return `<label class="staff-check"><input type="checkbox" value="${Number(item.service_id)}" ${closed||spent>=item.units?'disabled':''}><span>${safe(item.service_name)} · ${spent}/${Number(item.units)} орсон · ${Math.max(0,item.units-spent)} үлдсэн</span></label>`;
  }) : services.map(item=>`<label class="staff-check"><input type="checkbox" value="${item.id}" ${closed?'disabled':''}><span>${safe(item.name)}</span></label>`)).join('');
  $("pkgDetailKpis").innerHTML = [["Авсан багц", contract.package_label || "—", contract.status || "—"], ["Нийт орох эрх", total == null ? "—" : total, "үйлчилгээ"], ["Орсон", spent, `${history.length} бүртгэл`], ["Үлдсэн", left == null ? "—" : left, "үйлчилгээ"]].map(([label, value, note]) => `<div class="kpi"><div class="kpi-label">${safe(label)}</div><div class="kpi-value">${safe(value)}</div><div class="kpi-note">${safe(note)}</div></div>`).join("");
  renderAccount(contract);
  $("pkgVisitBody").innerHTML = history.length ? history.map((item) => {
    const employee = staff.find((person) => Number(person.id) === Number(item.staff_id));
    return `<tr><td class="t-mono">${safe(item.used_on)}</td><td class="t-strong">${safe(item.service_label || "—")}</td><td>${safe(item.units || 1)}</td><td>${safe(employee?.name || "—")}</td><td class="record-note">${safe(item.notes || "—")}</td></tr>`;
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
  customer.closest('.field').hidden=true;
  customerPicker($('pkgSaleSearch'),()=>customers,item=>{if(!item){customer.value='';return;} customer.replaceChildren(new Option(`${item.full_name} · ${item.phone||'Утас бүртгээгүй'}`,String(item.id),true,true));});
}

function options() {
  renderSaleCustomers();
  const selectedPackage = $("pkgLeadPurchased").value;
  const packageOptions = '<option value="">Сонгоогүй</option><option value="custom">+ Багц үүсгэх</option>' + packages.map((item) => `<option value="${item.id}">${safe(item.name)}</option>`).join("");
  $("pkgLeadPurchased").innerHTML = packageOptions;
  $("pkgLeadPurchased").value = selectedPackage;
  if (!$("pkgCustomDevices").children.length) $("pkgCustomDevices").innerHTML=services.map(item=>`<div class="field"><label for="pkgUnits${item.id}">${safe(item.name)} — орох тоо</label><input class="ctl" id="pkgUnits${item.id}" data-service-id="${item.id}" type="number" min="0" max="1000" step="1" value="0"></div>`).join('');
  $("pkgVisitServices").innerHTML = services.map((item) => `<label class="staff-check"><input type="checkbox" value="${item.id}" ${closed?'disabled':''}><span>${safe(item.name)}</span></label>`).join("");
  const employee = currentStaff();
  $("pkgLeadStaff").textContent = employee ? `Бүртгэх ажилтан: ${employee.name}` : "Хажуугийн хэсгээс бүртгэх ажилтны нэрийг сонгоно уу";
  renderPackageCustomers();
  renderSelectedPackage();
}

function renderLeads() {
  const employee = currentStaff(), admin = ["owner", "admin"].includes(profile.role);
  const rows = admin ? leads : leads.filter((item) => Number(item.staff_id) === Number(employee?.id));
  $("pkgLeadBody").innerHTML = rows.length ? rows.map((item) => `<tr><td>${new Date(item.created_at).toLocaleDateString("mn-MN")}</td><td class="t-strong">${safe(item.customer_label)}</td><td>${safe(item.purchased_package_label || "—")}</td><td>${safe(item.intended_package_label || "—")}</td><td>${safe(item.staff_name)}</td><td class="record-note">${safe(item.notes || "—")}</td></tr>`).join("") : '<tr><td colspan="6"><div class="empty">Багцын бүртгэл алга.</div></td></tr>';
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
    sb.from("packages").select("id,name,price,service_units").is("archived_at", null).eq("active", true).order("sort"),
    sb.from("staff").select("id,name,email,user_id,active").eq("active", true).order("sort"),
    sb.from("package_sales_leads").select("*").order("created_at", { ascending: false }),
    sb.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    allRows(() => sb.from("customer_package_contracts").select("id,customer_id,customer_label,package_id,package_label,total_units,status,purchased_on,expires_on,notes,service_units,agreed_price,opening_paid").order("customer_label").order("id")),
    allRows(() => sb.from("package_redemptions").select("id,contract_id,used_on,units,service_id,service_label,staff_id,notes,created_at").order("used_on", { ascending: false }).order("id")),
    sb.from("services").select("id,name,active,category").eq("active", true).neq("category", "legacy-import").order("sort"),
    sb.rpc('package_payment_history'),
    allRows(()=>sb.from('package_account_events').select('id,contract_id,action,detail,created_at').order('id')),
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
  accountSales=result[8].data||[];accountEvents=result[9].data||[];
  options();
  renderLeads();
  loadedUserId = user.id;
}

async function saveVisit() {
  const contract = contracts.find((item) => Number(item.id) === Number(selectedContractId));
  const employee = currentStaff(), date = $("pkgVisitDate").value;
  const selected = [...$("pkgVisitServices").querySelectorAll("input:checked")].map((input) => services.find((item) => String(item.id) === input.value)).filter(Boolean);
  if (!contract) return alert("Багцтай үйлчлүүлэгчээ сонгоно уу.");
  if(packageState(contract,used(contract.id),todayKey())!=='active') return alert("Энэ багц дууссан тул шинэ оролт бүртгэхгүй.");
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
  const custom=$("pkgLeadPurchased").value==='custom';
  if (!custom && !customer) return alert("Үйлчлүүлэгчээ сонгоно уу.");
  if (!custom && !customer.phone) return alert("Үйлчлүүлэгчид хэсэгт утасны дугаарыг бүртгэнэ үү.");
  if (!purchased && !custom) return alert("Багцаа сонгоно уу.");
  const items=custom ? customPackageItems() : [];
  if (custom && (!$("pkgCustomName").value.trim() || !items.length || items.some(item=>!Number.isInteger(item.units)||item.units>1000))) return alert('Багцын нэр, төхөөрөмжийн оролтын тоогоо зөв оруулна уу.');
  const bank = $("pkgSaleBank").value, amount = Number($("pkgSaleAmount").value), date = $("pkgSaleDate").value;
  if (!custom && (!date || !['golomt','khan','cash','invoice','barter','internal'].includes(bank) || !Number.isSafeInteger(amount) || amount < 0 || amount>Number(purchased.price))) return alert("Огноо, төлбөрийн хэлбэр болон багцын үнээс хэтрэхгүй дүн оруулна уу.");
  if (!employee && !["owner", "admin"].includes(profile.role)) return alert("Бүртгэх ажилтны нэрийг сонгоно уу.");
  const button = $("pkgLeadSave");
  if (button.disabled) return;
  button.disabled = true;
  try {
    const { data, error } = await sb.rpc('package_checkout',{p:{action:custom?'template':'sell',request_id:packageRequestId, customer_id:customer?.id || null, package_id:purchased?.id || null, booking_id:custom?null:checkoutBooking?.id, package_name:$("pkgCustomName").value.trim(), items, base_price:Number($("pkgCustomBase").value),discount_percent:Number($("pkgCustomDiscount").value),sale_date:date,staff_id:employee?.id || null,payment_method:bank,amount,note:$("pkgLeadNotes").value.trim() || null}});
    if (error) throw error;
    if(custom){packages=[data.package,...packages];packageRequestId=crypto.randomUUID();options();$('pkgLeadPurchased').value=String(data.package.id);$('pkgLeadPurchased').dispatchEvent(new Event('change'));$('pkgSaleStatus').textContent='Багцын загвар хадгалагдлаа. Борлуулахдаа үйлчлүүлэгчээ сонгоно уу.';return;}
    window.dispatchEvent(new CustomEvent('cryo:sale-saved', { detail: data.sale }));
    if(data.booking) window.dispatchEvent(new CustomEvent('cryo:booking-updated',{detail:data.booking}));
    checkoutBooking=null;
    if(data.sale) accountSales.push(data.sale);
    if (data.contract) contracts=[data.contract,...contracts.filter(row=>row.id!==data.contract.id)];
    if (data.package) packages=[data.package,...packages.filter(row=>row.id!==data.package.id)];
    packageRequestId=crypto.randomUUID();
    $("pkgCustomForm").hidden=true;
    $("pkgSaleAmount").readOnly=false;
    ['pkgLeadCustomer','pkgLeadPurchased','pkgLeadNotes','pkgSaleSearch','pkgSaleBank','pkgSaleAmount'].forEach(id => { $(id).value = ''; });
    $("pkgSalePrice").value = '—';
    $("pkgSaleStatus").textContent = `Багц бүртгэгдлээ · Энэ удаа ${money(amount)} · Үлдэгдэл ${money(Number(purchased.price)-amount)}`;
    if ($("packageSaleNotice")) $("packageSaleNotice").textContent = $("pkgSaleStatus").textContent;
    setPackageSaleOpen(false);
    $("repPackageSales")?.focus();
    renderSaleCustomers();
    options();
  } catch (error) {
    alert("Борлуулалт хадгалж чадсангүй: " + error.message);
  } finally { button.disabled = false; }
}

function renderAccount(contract){
 let panel=$('pkgAccount');if(!panel){panel=document.createElement('div');panel.id='pkgAccount';panel.className='panel';$('pkgDetailKpis').after(panel);}
 const rows=accountSales.filter(s=>Number(s.package_contract_id)===Number(contract.id));
 const paid=Number(contract.opening_paid||0)+rows.reduce((sum,s)=>sum+Number(s.total||0)+Number(s.internal_amount||0),0);
 const known=contract.agreed_price!=null,balance=known?Number(contract.agreed_price)-paid:null;
 const methods='<option value="khan">Хаан</option><option value="golomt">Голомт</option><option value="cash">Бэлэн</option><option value="invoice">Нэхэмжлэх</option><option value="barter">Бартер</option><option value="internal">Дотоод</option>';
 const events=accountEvents.filter(e=>Number(e.contract_id)===Number(contract.id)&&['change','transfer','opening'].includes(e.action));
 panel.innerHTML=`<h3>Багцын төлбөр, үлдэгдэл</h3><p>${known?`Тохирсон үнэ: ${money(contract.agreed_price)} · Бүртгэсэн төлөлт/тооцоо: ${money(paid)} · Үлдэгдэл: <b>${money(balance)}</b>`:'Хуучин багцын үнэ, өмнөх төлөлт баталгаажаагүй. Админ эхний үлдэгдлийг баталгаажуулна.'}</p><p class="page-sub">Банк/бэлэн, бартер, нэхэмжлэх, дотоод хэлбэрүүд тусдаа хадгалагдана. Дотоод дүн мөнгөн орлогод нэмэгдэхгүй. Зөвхөн энэ удаа төлсөн дүнгээ оруулна.</p>
 ${known&&balance>0?`<div class="form-grid"><div class="field"><label>Төлөлтийн огноо</label><input class="ctl" id="pkgPayDate" type="date" value="${todayKey()}"></div><div class="field"><label>Төлбөрийн хэлбэр</label><select class="ctl" id="pkgPayMethod">${methods}</select></div><div class="field"><label>Энэ удаа төлөх</label><input class="ctl" id="pkgPayAmount" type="number" min="1" max="${balance}" value="${balance}"></div></div><button class="btn-sm primary" id="pkgPayMore">Төлөлт нэмэх</button>`:''}
 <details><summary>Төлөлтийн түүх</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Огноо</th><th>Хэлбэр</th><th>Дүн</th><th>Тэмдэглэл</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${safe(s.sale_date)}</td><td>${['golomt','khan','cash','invoice','barter','internal_amount'].filter(k=>Number(s[k])>0).map(k=>({golomt:'Голомт',khan:'Хаан',cash:'Бэлэн',invoice:'Нэхэмжлэх',barter:'Бартер',internal_amount:'Дотоод'}[k])).join(', ')}</td><td>${money(Number(s.total)+Number(s.internal_amount||0))}</td><td>${safe(s.note||'')}</td></tr>`).join('')||'<tr><td colspan="4">Төлөлтийн мөр алга</td></tr>'}</tbody></table></div></details>
 <details><summary>Багц солих / өөр үйлчлүүлэгчид шилжүүлэх</summary><p class="page-sub">Багц солиход өмнөх төлөлт ба ашигласан оролт хэвээр үлдэнэ. Шинэ багцын үнээс өмнөх төлөлтийг хасаж үлдэгдэл гаргана. Шилжүүлэхэд хуучин түүх устахгүй.</p><div class="field"><label>Шинэ багц</label><select class="ctl" id="pkgChangeTarget"><option value="">Багц сонгох</option>${packages.map(p=>`<option value="${p.id}">${safe(p.name)} · ${money(p.price)}</option>`).join('')}</select></div><button class="btn-sm ghost" id="pkgChange" ${known?'':'disabled'}>Багц солих</button><div class="field"><label>Шилжүүлэн авах үйлчлүүлэгч</label><input class="ctl" id="pkgTransferSearch" type="search" placeholder="Нэрээр хайх"><select class="ctl" id="pkgTransferTarget"></select></div><div class="field"><label>Шалтгаан / тэмдэглэл</label><input class="ctl" id="pkgAccountNote" maxlength="500"></div><button class="btn-sm ghost" id="pkgTransfer">Үйлчлүүлэгчид шилжүүлэх</button></details>
 ${!known&&['owner','admin'].includes(profile.role)?'<details><summary>Хуучин багцын эхний үлдэгдлийг баталгаажуулах</summary><p>Өмнөх борлуулалтыг дахин орлогод нэмэхгүй.</p><label>Тохирсон нийт үнэ<input class="ctl" id="pkgOpeningPrice" type="number" min="0"></label><label>Өмнө төлсөн нийт дүн<input class="ctl" id="pkgOpeningPaid" type="number" min="0"></label><label>Нотлох тэмдэглэл<input class="ctl" id="pkgOpeningNote" maxlength="500"></label><button class="btn-sm ghost" id="pkgOpening">Баталгаажуулах</button></details>':''}
 <details><summary>Өөрчлөлтийн түүх</summary>${events.map(e=>`<p>${safe(e.created_at.slice(0,10))} · ${safe({change:'Багц сольсон',transfer:'Үйлчлүүлэгч шилжүүлсэн',opening:'Эхний үлдэгдэл баталгаажуулсан'}[e.action])} · ${safe(e.detail.before?.package_label||'')} → ${safe(e.detail.contract?.package_label||'')} · ${safe(e.detail.before?.customer_label||'')} → ${safe(e.detail.contract?.customer_label||'')} · ${safe(e.detail.note||'')}</p>`).join('')||'<p>Өөрчлөлт алга.</p>'}</details>`;
 const filterCustomers=()=>{const query=$('pkgTransferSearch').value;$('pkgTransferTarget').innerHTML='<option value="">Үйлчлүүлэгч сонгох</option>'+customers.filter(c=>c.id!==contract.customer_id&&(matchesName(c.full_name,query)||(query&&String(c.phone||'').includes(query)))).map(c=>`<option value="${c.id}">${safe(c.full_name)} · ${safe(c.phone||'')}</option>`).join('');};filterCustomers();$('pkgTransferTarget').hidden=true;customerPicker($('pkgTransferSearch'),()=>customers.filter(c=>c.id!==contract.customer_id),c=>{$('pkgTransferTarget').value=c?String(c.id):'';});
 let request=crypto.randomUUID();
 const act=async(button,action,extra)=>{if(button.disabled)return;button.disabled=true;try{const r=await sb.rpc('package_checkout',{p:{action,request_id:request,contract_id:contract.id,staff_id:currentStaff()?.id||null,...extra}});if(r.error)throw r.error;if(r.data.sale)window.dispatchEvent(new CustomEvent('cryo:sale-saved',{detail:r.data.sale}));request=crypto.randomUUID();await load();alert('Хадгалагдлаа.');}catch(e){alert(e.message);button.disabled=false;}};
 $('pkgPayMore')?.addEventListener('click',e=>act(e.currentTarget,'pay',{amount:Number($('pkgPayAmount').value),payment_method:$('pkgPayMethod').value,sale_date:$('pkgPayDate').value,note:'Багцын үлдэгдэл төлөлт'}));
 $('pkgChange').onclick=e=>{const target=packages.find(p=>String(p.id)===$('pkgChangeTarget').value);if(!target)return alert('Багцаа сонгоно уу.');if(confirm(`${target.name} багц руу солих уу? Шинэ үнэ ${money(target.price)}, өмнөх төлөлт ${money(paid)}, шинэ үлдэгдэл ${money(target.price-paid)}.`))act(e.currentTarget,'change',{package_id:target.id});};
 $('pkgTransfer').onclick=e=>{const target=customers.find(c=>String(c.id)===$('pkgTransferTarget').value);if(!target)return alert('Үйлчлүүлэгч сонгоно уу.');if(confirm(`${contract.customer_label}-ийн багцыг ${target.full_name}-д шилжүүлэх үү? Үлдэгдэл төлбөр мөн шилжинэ.`))act(e.currentTarget,'transfer',{customer_id:target.id,note:$('pkgAccountNote').value.trim()});};
 $('pkgOpening')?.addEventListener('click',e=>act(e.currentTarget,'opening',{agreed_price:Number($('pkgOpeningPrice').value),opening_paid:Number($('pkgOpeningPaid').value),note:$('pkgOpeningNote').value.trim()}));
}

document.addEventListener("DOMContentLoaded", () => {
  panels(); fixDay();
  $("pkgLeadSave").addEventListener("click", saveLead);
  $("pkgVisitSave").addEventListener("click", saveVisit);
  $("sharedStaffSelect")?.addEventListener("change", () => { options(); renderLeads(); });
  window.addEventListener("cryo:staff-changed", () => { options(); renderLeads(); });
  sb.auth.onAuthStateChange((_event, session) => {
    if (!session) { loadedUserId=null; return; }
    if (session.user.id !== loadedUserId) setTimeout(load, 0);
  });
  load();
});
