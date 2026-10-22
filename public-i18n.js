/* Public presentation only. Never translate form values, IDs, private data or ERP. */
(function () {
  'use strict';
  const path = location.pathname.replace(/\/$/, '').replace(/\.html$/, '');
  if (!['', '/index', '/hub', '/cabin', '/xcryo', '/oxypro', '/ledpro', '/privacy', '/data-deletion'].includes(path)) return;
  const copy = window.CryoPublicCopy || {};
  const englishSource = window.CryoPublicEnglishSource || {};
  const normalise = value => String(value).replace(/\s+/g, ' ').trim();
  const storageKey = 'cryo-public-language';
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch { /* Private mode: memory only. */ }
  const query = new URL(location.href).searchParams.get('lang');
  let language = ['mn', 'en'].includes(query) ? query : saved === 'en' ? 'en' : 'mn';
  const records = new WeakMap();
  const attributes = ['alt', 'title', 'placeholder', 'aria-label', 'label'];
  const excluded = 'script,style,noscript,textarea,code,pre,[translate="no"],[data-no-translate],.acct-name,.acct-mail,.my-ref,.my-when,#myLead,#confirmCustomer';
  // Translate a textarea's UI labels, never its user-entered content.
  const attributeExcluded = excluded.replace('textarea,', '');
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const insensitive = new Map(Object.entries(copy).map(([key, value]) => [key.toLocaleLowerCase('mn'), value]));

  function translate(value, target = language) {
    const source = normalise(value);
    if (has(englishSource, source)) return target === 'mn' ? englishSource[source] : source;
    if (target === 'mn') return value;
    if (has(copy, source)) return copy[source];
    if (insensitive.has(source.toLocaleLowerCase('mn'))) return insensitive.get(source.toLocaleLowerCase('mn'));
    let match;
    if ((match = source.match(/^(\d+(?:[.–-]\d+)?)\s*(минут|мин)$/))) return `${match[1]} min`;
    if ((match = source.match(/^(\d+) минут · цагийн сонголт (\d+) минутын зайтай$/))) return `${match[1]} min · appointment times every ${match[2]} min`;
    if ((match = source.match(/^(\d+) минут \+ 2 минутын төхөөрөмж бэлтгэх завсар$/))) return `${match[1]} min + 2 min equipment preparation`;
    if ((match = source.match(/^(\d+) үйлчилгээ$/))) return `${match[1]} service${match[1] === '1' ? '' : 's'}`;
    if ((match = source.match(/^(\d+)% хөнгөлөлт$/))) return `${match[1]}% off`;
    if ((match = source.match(/^(.+) · (\d+) мин$/))) return `${translate(match[1], target)} · ${match[2]} min`;
    if ((match = source.match(/^(.+) — QPAY$/))) {
      const bank = Object.keys(copy).find(key => key.toUpperCase() === match[1]);
      return `${bank ? copy[bank] : match[1]} — QPAY`;
    }
    return value; // Missing copy stays visible; coverage tests prevent shipping omissions.
  }

  function renderValue(owner, key, value, write) {
    let map = records.get(owner);
    if (!map) { map = new Map(); records.set(owner, map); }
    let record = map.get(key);
    // A real renderer update replaces the source; our own last rendering does not.
    if (!record || value !== record.rendered) record = { source: value, rendered: value };
    const contextual = key === 'text' && owner.parentElement?.dataset.i18nEn;
    const rendered = contextual && language === 'en' ? contextual : translate(record.source);
    const leading = record.source.match(/^\s*/)[0];
    const trailing = record.source.match(/\s*$/)[0];
    const next = rendered === record.source ? record.source : leading + rendered + trailing;
    if (value !== next) write(next);
    record.rendered = next;
    map.set(key, record);
  }

  function switcher() {
    const group = document.createElement('div');
    group.className = 'public-language';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Хэл сонгох');
    for (const [lang, label] of [['mn', 'Монгол'], ['en', 'English']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.lang = lang;
      button.dataset.publicLanguage = lang;
      button.setAttribute('translate', 'no');
      button.textContent = label;
      button.addEventListener('click', () => setLanguage(lang));
      group.append(button);
    }
    return group;
  }

  let observer;
  let scheduled = false;
  const observe = () => observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: [...attributes, 'content']
  });

  function render() {
    observer?.disconnect();
    document.documentElement.lang = language;
    document.querySelectorAll('.modal').forEach(modal => {
      if (!modal.querySelector('.public-language')) modal.prepend(switcher());
    });
    // An option without an explicit value derives its submitted value from its text.
    // Preserve that original value before changing the visible label.
    document.querySelectorAll('option:not([value])').forEach(option => option.setAttribute('value', option.textContent));
    document.querySelectorAll('[data-i18n-en]').forEach(el => {
      if (!el.childNodes.length) el.append(document.createTextNode(''));
    });
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement && !node.parentElement.closest(excluded) && (normalise(node.data) || node.parentElement.hasAttribute('data-i18n-en'))
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const textNode = node;
      renderValue(node, 'text', node.data, next => { textNode.data = next; });
    }
    document.querySelectorAll('[alt],[title],[placeholder],[aria-label],[label],meta[content]').forEach(el => {
      if (el.closest(attributeExcluded)) return;
      for (const attr of attributes) {
        if (el.hasAttribute(attr)) renderValue(el, attr, el.getAttribute(attr), next => el.setAttribute(attr, next));
      }
      if (el.tagName === 'META' && ['description', 'og:title', 'og:description', 'twitter:title', 'twitter:description'].includes(el.name || el.getAttribute('property'))) {
        renderValue(el, 'content', el.content, next => { el.content = next; });
      }
    });
    const locale = document.querySelector('meta[property="og:locale"]');
    if (locale) locale.content = language === 'en' ? 'en_US' : 'mn_MN';
    document.querySelectorAll('[data-public-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.publicLanguage === language)));
    if (observer) observe();
  }

  function setLanguage(next) {
    if (!['mn', 'en'].includes(next)) return;
    language = next;
    try { localStorage.setItem(storageKey, next); } catch { /* Switching still works. */ }
    const url = new URL(location.href);
    url.searchParams.set('lang', next);
    try { history.replaceState(history.state, '', url); } catch { /* Embedded browsers may restrict history. */ }
    render();
    document.querySelectorAll('input,select,textarea').forEach(input => {
      if (input.dataset.publicValidation) updateValidation(input);
    });
    document.dispatchEvent(new CustomEvent('cryo:languagechange', { detail: { language } }));
  }

  const nav = document.querySelector('#navbar');
  const topnav = document.querySelector('.topnav');
  if (nav) nav.insertBefore(switcher(), nav.querySelector('.hamburger'));
  else if (topnav) topnav.append(switcher());
  else document.querySelector('main')?.prepend(switcher());
  // Keep an explicit ?lang= choice across navigation as well as button choices.
  try { localStorage.setItem(storageKey, language); } catch { /* Optional persistence. */ }
  window.CryoI18n = Object.freeze({ t: translate, setLanguage, get language() { return language; } });
  function updateValidation(input) {
    input.setCustomValidity('');
    let message = '';
    if (input.validity.valueMissing) message = 'Энэ талбарыг бөглөнө үү.';
    else if (input.validity.typeMismatch && input.type === 'email') message = 'И-мэйл хаягаа зөв оруулна уу.';
    else if (input.validity.tooShort) message = language === 'en' ? `Enter at least ${input.minLength} characters.` : `Хамгийн багадаа ${input.minLength} тэмдэгт оруулна уу.`;
    else if (!input.validity.valid) message = 'Мэдээллээ шалгаад зөв оруулна уу.';
    input.setCustomValidity(translate(message));
    input.dataset.publicValidation = message ? 'true' : '';
  }
  document.addEventListener('invalid', event => {
    if (event.target.matches('input,select,textarea')) updateValidation(event.target);
  }, true);
  document.addEventListener('input', event => {
    if (event.target.dataset.publicValidation) {
      event.target.setCustomValidity('');
      event.target.dataset.publicValidation = '';
    }
  });
  render();
  observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  });
  observe();
})();
