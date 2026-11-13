// Gift card register: issue a card, see who holds it, deduct usage.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { matchesName } from './name-search.js';

const cfg = window.CRYO_SUPABASE || {}, sb = createClient(cfg.url, cfg.anonKey), $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => '₮' + Number(value || 0).toLocaleString('en-US');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const METHODS = { golomt: 'Голомт', khan: 'Хаан', cash: 'Бэлэн', invoice: 'Нэхэмжлэх', barter: 'Бартер', internal: 'Дотоод' };

let cards = [], uses = [], staff = [], user = null, isAdmin = false, selected = null, loading = false;
let issueRequest = crypto.randomUUID(), useRequest = crypto.randomUUID();

function employee() {
  const id = Number($('sharedStaffSelect')?.value);
  return staff.find(s => s.active && s.id === id)
    || staff.find(s => s.active && (s.user_id === user?.id || (s.email && s.email.toLowerCase() === user?.email?.toLowerCase())));
}
export function cardSpent(card) { return uses.filter(u => Number(u.card_id) === Number(card.id)).reduce((sum, u) => sum + Number(u.amount || 0), 0); }
const balance = card => Number(card.amount) - cardSpent(card);
const say = text => { $('gcStatus').textContent = text; };

function markup() {
  const host = $('giftCardsPanel');
  if (!host || host.dataset.ready) return;
  host.dataset.ready = '1';
  host.innerHTML = `
  <div class="page-head"><div><div class="page-title">Gift card</div><div class="page-sub">Олгосон gift card, авсан хүн, үнийн дүн, ашиглалт, үлдэгдэл</div></div>
    <button class="btn-sm primary" id="gcAdd">+ Gift card олгох</button></div>
  <p class="page-sub" id="gcStatus" role="status"></p>
  <div class="kpis" id="gcKpis"></div>
  <div class="panel" id="gcForm" hidden>
    <div class="panel-head"><div class="panel-title">Gift card олгох</div></div>
    <div class="form-grid">
      <div class="field"><label for="gcDate">Олгосон өдөр *</label><input class="ctl" type="date" id="gcDate"></div>
      <div class="field"><label for="gcCode">Картын дугаар</label><input class="ctl" id="gcCode" maxlength="40" placeholder="Хоосон бол автоматаар"></div>
      <div class="field"><label for="gcAmount">Үнийн дүн (₮) *</label><input class="ctl" type="number" id="gcAmount" min="1" step="1000"></div>
      <div class="field"><label for="gcMethod">Төлбөрийн хэлбэр *</label><select class="ctl" id="gcMethod"><option value="">Сонгох</option>${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    </div>
    <div class="form-sub">Худалдаж авсан / өгсөн хүн</div>
    <div class="form-grid">
      <div class="field"><label for="gcBuyer">Нэр</label><input class="ctl" id="gcBuyer" maxlength="160"></div>
      <div class="field"><label for="gcBuyerPhone">Утас</label><input class="ctl" type="tel" id="gcBuyerPhone" maxlength="30"></div>
    </div>
    <div class="form-sub">Gift card авсан хүн</div>
    <div class="form-grid">
      <div class="field"><label for="gcRecipient">Нэр *</label><input class="ctl" id="gcRecipient" maxlength="160"></div>
      <div class="field"><label for="gcRecipientPhone">Утас</label><input class="ctl" type="tel" id="gcRecipientPhone" maxlength="30"></div>
      <div class="field" style="grid-column:span 2"><label for="gcNote">Тэмдэглэл</label><input class="ctl" id="gcNote" maxlength="500"></div>
    </div>
    <p class="page-sub">Олгосон өдрөөр борлуулалтад орлого болж бүртгэгдэнэ. Дараа нь картаар төлөхөд орлогод давхар нэмэгдэхгүй.</p>
    <div class="form-actions"><button class="btn-sm primary" id="gcSave">Gift card бүртгэх</button><button class="btn-sm ghost" id="gcCancel">Болих</button></div>
  </div>
  <div class="panel"><div class="form-grid">
    <div class="field" style="grid-column:span 2"><label for="gcSearch">Хайх</label><input class="ctl" type="search" id="gcSearch" placeholder="Нэр, утас эсвэл картын дугаар" autocomplete="off"></div>
    <div class="field"><label for="gcFilter">Төлөв</label><select class="ctl" id="gcFilter"><option value="open">Үлдэгдэлтэй</option><option value="all">Бүгд</option><option value="spent">Дууссан</option><option value="archived">Архивласан</option></select></div>
  </div></div>
  <div class="panel" style="padding:0;overflow:hidden"><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Дугаар</th><th>Олгосон өдөр</th><th>Авсан хүн</th><th>Өгсөн хүн</th><th>Үнийн дүн</th><th>Ашигласан</th><th>Үлдэгдэл</th><th></th></tr></thead>
    <tbody id="gcBody"></tbody></table></div></div>
  <div id="gcDetail"></div>`;
  $('gcAdd').onclick = () => { $('gcForm').hidden = false; $('gcDate').value = $('gcDate').value || today(); $('gcRecipient').focus(); };
  $('gcCancel').onclick = () => { $('gcForm').hidden = true; };
  $('gcSave').onclick = issue;
  $('gcSearch').oninput = render; $('gcFilter').onchange = render;
}

async function allRows(table) {
  const data = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await sb.from(table).select('*').order('id').range(offset, offset + 999);
    if (r.error) throw r.error;
    data.push(...r.data);
    if (r.data.length < 1000) return data;
  }
}

async function load() {
  if (loading || !$('giftCardsPanel')) return;
  loading = true;
  try {
    const session = (await sb.auth.getSession()).data.session;
    if (!session) return;
    user = session.user;
    const admin = await sb.rpc('is_admin');
    isAdmin = admin.data === true;
    [cards, uses, staff] = await Promise.all(['gift_cards', 'gift_card_uses', 'staff'].map(allRows));
    say('');
    render();
  } catch (error) {
    say('Gift card-ын мэдээлэл ачаалж чадсангүй: ' + error.message);
  } finally { loading = false; }
}

function render() {
  const query = $('gcSearch').value.trim(), filter = $('gcFilter').value, digits = query.replace(/\s/g, '');
  const live = cards.filter(c => !c.archived_at);
  $('gcKpis').innerHTML = [
    ['Олгосон карт', live.length, 'ширхэг'],
    ['Нийт үнийн дүн', money(live.reduce((n, c) => n + Number(c.amount), 0)), 'олгосон'],
    ['Ашигласан', money(live.reduce((n, c) => n + cardSpent(c), 0)), 'хасагдсан'],
    ['Үлдэгдэл', money(live.reduce((n, c) => n + balance(c), 0)), `${live.filter(c => balance(c) > 0).length} карт`],
  ].map(([label, value, note]) => `<div class="kpi"><div class="kpi-label">${safe(label)}</div><div class="kpi-value">${safe(value)}</div><div class="kpi-note">${safe(note)}</div></div>`).join('');
  const rows = cards.filter(c => {
    if (filter === 'archived') return !!c.archived_at;
    if (c.archived_at) return false;
    if (filter === 'open' && balance(c) <= 0) return false;
    if (filter === 'spent' && balance(c) > 0) return false;
    return true;
  }).filter(c => !query || matchesName(c.recipient_name, query) || matchesName(c.buyer_name || '', query) || matchesName(c.code, query)
    || (digits && [c.recipient_phone, c.buyer_phone].some(p => String(p || '').replace(/\s/g, '').includes(digits))))
    .sort((a, b) => String(b.issued_on).localeCompare(String(a.issued_on)) || b.id - a.id);
  $('gcBody').innerHTML = rows.length ? rows.map(c => `<tr class="${Number(selected) === Number(c.id) ? 'on' : ''}">
    <td class="t-mono t-strong">${safe(c.code)}</td><td class="t-mono">${safe(c.issued_on)}</td>
    <td><div class="t-strong">${safe(c.recipient_name)}</div><div style="font-size:11.5px;color:var(--text-muted)">${safe(c.recipient_phone || '')}</div></td>
    <td><div>${safe(c.buyer_name || '—')}</div><div style="font-size:11.5px;color:var(--text-muted)">${safe(c.buyer_phone || '')}</div></td>
    <td class="t-mono">${money(c.amount)}</td><td class="t-mono">${money(cardSpent(c))}</td><td class="t-mono t-strong">${money(balance(c))}</td>
    <td><button class="btn-sm ghost" data-card="${c.id}">Дэлгэрэнгүй / ашиглалт хасах</button></td></tr>`).join('')
    : '<tr><td colspan="8"><div class="empty">Gift card алга байна.</div></td></tr>';
  $('gcBody').querySelectorAll('[data-card]').forEach(button => button.onclick = () => { selected = Number(button.dataset.card); render(); $('gcDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  renderDetail();
}

function renderDetail() {
  const host = $('gcDetail'), card = cards.find(c => Number(c.id) === Number(selected));
  if (!card) { host.innerHTML = ''; return; }
  const history = uses.filter(u => Number(u.card_id) === Number(card.id)).sort((a, b) => String(b.used_on).localeCompare(String(a.used_on)) || b.id - a.id);
  const left = balance(card), giver = staff.find(s => Number(s.id) === Number(card.staff_id));
  host.innerHTML = `<div class="panel">
    <div class="panel-head"><div><div class="panel-title">${safe(card.code)} · ${safe(card.recipient_name)}</div>
      <div class="page-sub">Олгосон: ${safe(card.issued_on)} · ${safe(METHODS[card.payment_method] || '—')} · Бүртгэсэн: ${safe(giver?.name || '—')}${card.buyer_name ? ` · Өгсөн: ${safe(card.buyer_name)} ${safe(card.buyer_phone || '')}` : ''}${card.note ? ` · ${safe(card.note)}` : ''}</div></div>
      ${isAdmin ? `<button class="btn-sm ghost" id="gcArchive">${card.archived_at ? 'Сэргээх' : 'Архивлах'}</button>` : ''}</div>
    <div class="kpis">${[['Үнийн дүн', money(card.amount)], ['Ашигласан', money(card.amount - left)], ['Үлдэгдэл', money(left)]].map(([l, v]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`).join('')}</div>
    ${left > 0 && !card.archived_at ? `<div class="form-sub">Ашиглалт хасах</div><div class="form-grid">
      <div class="field"><label for="gcUseDate">Ашигласан өдөр *</label><input class="ctl" type="date" id="gcUseDate" value="${today()}"></div>
      <div class="field"><label for="gcUseAmount">Хасах дүн (₮) *</label><input class="ctl" type="number" id="gcUseAmount" min="1" max="${left}" step="1000" value="${left}"></div>
      <div class="field"><label for="gcUseService">Авсан үйлчилгээ</label><input class="ctl" id="gcUseService" maxlength="200"></div>
      <div class="field"><label for="gcUseNote">Тэмдэглэл</label><input class="ctl" id="gcUseNote" maxlength="500"></div>
    </div><div class="form-actions"><button class="btn-sm primary" id="gcUseSave">Ашиглалт хасах</button></div>` : `<p class="page-sub">${card.archived_at ? 'Архивласан карт.' : 'Энэ картын үлдэгдэл дууссан.'}</p>`}
    <div class="form-sub">Ашиглалтын түүх</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Өдөр</th><th>Дүн</th><th>Үйлчилгээ</th><th>Ажилтан</th><th>Тэмдэглэл</th><th></th></tr></thead><tbody>
    ${history.length ? history.map(u => `<tr><td class="t-mono">${safe(u.used_on)}</td><td class="t-mono t-strong">${money(u.amount)}</td><td>${safe(u.service || '—')}</td><td>${safe(staff.find(s => Number(s.id) === Number(u.staff_id))?.name || '—')}</td><td class="record-note">${safe(u.note || '—')}</td><td>${isAdmin ? `<button class="btn-sm ghost" data-use="${u.id}">Буцаах</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty">Ашиглалт бүртгэгдээгүй.</div></td></tr>'}
    </tbody></table></div></div>`;
  if ($('gcUseSave')) $('gcUseSave').onclick = () => deduct(card);
  if ($('gcArchive')) $('gcArchive').onclick = () => manage({ action: card.archived_at ? 'restore' : 'archive', card_id: card.id }, card.archived_at ? null : `${card.code} картыг архивлах уу?`);
  host.querySelectorAll('[data-use]').forEach(button => button.onclick = () => manage({ action: 'remove_use', use_id: Number(button.dataset.use) }, 'Энэ ашиглалтыг буцааж, үлдэгдэлд нэмэх үү?'));
}

async function issue() {
  const button = $('gcSave');
  if (button.disabled) return;
  const amount = Number($('gcAmount').value), who = employee();
  if (!$('gcRecipient').value.trim()) return alert('Gift card авсан хүний нэрийг оруулна уу.');
  if (!Number.isSafeInteger(amount) || amount <= 0) return alert('Үнийн дүнгээ оруулна уу.');
  if (!$('gcMethod').value) return alert('Төлбөрийн хэлбэрээ сонгоно уу.');
  if (!$('gcDate').value) return alert('Олгосон өдрөө сонгоно уу.');
  if (!who && !isAdmin) return alert('Бүртгэх ажилтны нэрээ сонгоно уу.');
  button.disabled = true;
  try {
    const { data, error } = await sb.rpc('issue_gift_card', { p: {
      request_id: issueRequest, staff_id: who?.id || null, issued_on: $('gcDate').value, code: $('gcCode').value.trim(),
      amount, payment_method: $('gcMethod').value, buyer_name: $('gcBuyer').value.trim(), buyer_phone: $('gcBuyerPhone').value.trim(),
      recipient_name: $('gcRecipient').value.trim(), recipient_phone: $('gcRecipientPhone').value.trim(), note: $('gcNote').value.trim(),
    } });
    if (error) throw error;
    issueRequest = crypto.randomUUID();
    cards = [data.card, ...cards.filter(c => c.id !== data.card.id)];
    if (data.sale) window.dispatchEvent(new CustomEvent('cryo:sale-saved', { detail: data.sale }));
    ['gcCode', 'gcAmount', 'gcMethod', 'gcBuyer', 'gcBuyerPhone', 'gcRecipient', 'gcRecipientPhone', 'gcNote'].forEach(id => { $(id).value = ''; });
    $('gcForm').hidden = true; selected = data.card.id;
    say(`${data.card.code} · ${data.card.recipient_name} · ${money(data.card.amount)} бүртгэгдлээ.`);
    render();
  } catch (error) { alert('Gift card бүртгэж чадсангүй: ' + error.message); }
  finally { button.disabled = false; }
}

async function deduct(card) {
  const button = $('gcUseSave');
  if (button.disabled) return;
  const amount = Number($('gcUseAmount').value), who = employee();
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > balance(card)) return alert(`Хасах дүн үлдэгдлээс (${money(balance(card))}) хэтрэхгүй байна.`);
  if (!who && !isAdmin) return alert('Бүртгэх ажилтны нэрээ сонгоно уу.');
  button.disabled = true;
  try {
    const { data, error } = await sb.rpc('use_gift_card', { p: { request_id: useRequest, staff_id: who?.id || null, card_id: card.id, amount, used_on: $('gcUseDate').value, service: $('gcUseService').value.trim(), note: $('gcUseNote').value.trim() } });
    if (error) throw error;
    useRequest = crypto.randomUUID();
    uses = [...uses.filter(u => u.id !== data.use.id), data.use];
    render();
  } catch (error) { alert('Ашиглалт хасаж чадсангүй: ' + error.message); button.disabled = false; }
}

async function manage(payload, question) {
  if (question && !confirm(question)) return;
  const { error } = await sb.rpc('manage_gift_card', { p: payload });
  if (error) return alert(error.message);
  await load();
}

document.addEventListener('DOMContentLoaded', () => {
  markup();
  $('navGiftCards')?.addEventListener('click', load);
  window.addEventListener('cryo:gift-cards-changed', load);
  sb.auth.onAuthStateChange((_event, session) => { if (session) setTimeout(load, 0); });
  load();
});
