// AppFill content script: finds form fields, works out what each one is
// asking for, and fills it from your profile, custom answers, or answers
// you saved on this site.
(() => {
  if (globalThis.__appfillLoaded) return;
  globalThis.__appfillLoaded = true;

  const { RULES, AUTOCOMPLETE, PROFILE_FIELDS, norm, aliases, valueFor } = globalThis.AF;
  const SITE_KEY = 'site:' + location.hostname;
  let lastTarget = null;

  document.addEventListener('contextmenu', e => {
    lastTarget = (e.composedPath && e.composedPath()[0]) || e.target;
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handle(msg).then(sendResponse, err => {
      console.warn('[AppFill]', err);
      sendResponse({ error: String(err) });
    });
    return true;
  });

  async function handle(msg) {
    const store = await chrome.storage.local.get(['profile', 'custom', SITE_KEY]);
    const ctx = {
      profile: store.profile || {},
      custom: (store.custom || []).filter(c => c.q && c.a),
      site: (store[SITE_KEY] && store[SITE_KEY].fields) || {},
    };
    if (msg.type === 'fillPage') return fillPage(ctx);
    if (msg.type === 'scanPage') return scanPage(ctx);
    if (msg.type === 'fillField') return fillOne(ctx, msg);
    if (msg.type === 'savePage') return savePage();
    if (msg.type === 'forgetPage') return forgetPage();
  }

  // ---------- finding fields ----------

  function allControls(root = document, out = []) {
    root.querySelectorAll('input, textarea, select').forEach(el => out.push(el));
    root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) allControls(el.shadowRoot, out); });
    return out;
  }

  const SKIP_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image', 'search', 'color', 'range']);

  function kindOf(el) {
    if (el.tagName === 'SELECT') return 'select';
    if (el.tagName === 'TEXTAREA') return 'text';
    const t = (el.type || 'text').toLowerCase();
    if (t === 'radio' || t === 'checkbox') return t;
    return 'text';
  }

  // Laid out on the page at all (not display:none or visibility:hidden).
  function isRendered(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  // A trap field: on the page, but disguised so you can't see it.
  // Returns the trick used, or '' if the field is genuinely visible.
  function disguise(el) {
    if ((el.type === 'radio' || el.type === 'checkbox') && el.labels && el.labels[0] &&
        el.labels[0].getClientRects().length) return ''; // custom-styled choice with a visible label
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return 'tiny';
    if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return 'off the page';
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (parseFloat(getComputedStyle(n).opacity) === 0) return 'see-through';
    }
    return '';
  }

  function isVisible(el) {
    if ((el.type === 'radio' || el.type === 'checkbox') && el.labels && el.labels[0] &&
        el.labels[0].getClientRects().length) return true;
    return isRendered(el) && !disguise(el);
  }

  function fillable(el) {
    if (el.disabled || el.readOnly) return false;
    return !(el.tagName === 'INPUT' && SKIP_TYPES.has((el.type || '').toLowerCase()));
  }

  function usable(el) { return fillable(el) && isVisible(el); }

  function fields() { return allControls().filter(usable); }

  // Disguised fields that ask for something AppFill knows about you.
  function findTraps(ctx) {
    const seen = new Set(), traps = [];
    for (const el of allControls()) {
      if (!fillable(el) || !isRendered(el)) continue;
      const trick = disguise(el);
      if (!trick) continue;
      if (el.type === 'radio' && el.name) { if (seen.has(el.name)) continue; seen.add(el.name); }
      const d = describe(el);
      const choice = decide(d, ctx);
      if (!choice) continue;
      traps.push({ el, trick, asks: choice.key ? keyName(choice.key) : (d.primary || 'a saved answer').toLowerCase() });
    }
    return traps;
  }

  const KEY_NAMES = { fullName: 'full name', location: 'city and state' };
  function keyName(key) {
    if (KEY_NAMES[key]) return KEY_NAMES[key];
    const f = PROFILE_FIELDS.find(x => x.key === key);
    return f ? f.label.replace(/\?$/, '').toLowerCase().replace(/^linkedin/, 'LinkedIn').replace(/^github/, 'GitHub') : key;
  }

  function listWords(arr) {
    const u = [...new Set(arr)];
    if (u.length <= 1) return u.join('');
    return u.slice(0, -1).join(', ') + ' and ' + u[u.length - 1];
  }

  function trapNote(traps) {
    if (!traps.length) return '';
    const n = traps.length;
    return `${n} hidden field${n === 1 ? '' : 's'} on this page ask${n === 1 ? 's' : ''} for your ${listWords(traps.map(t => t.asks))}. AppFill left ${n === 1 ? 'it' : 'them'} empty.`;
  }

  // ---------- reading what a field is asking ----------

  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  function textMinusControls(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('input, select, textarea, option, script, style, button').forEach(n => n.remove());
    return clean(c.textContent);
  }

  function byId(el, id) {
    const root = el.getRootNode();
    return (root.getElementById && root.getElementById(id)) || document.getElementById(id);
  }

  function primaryLabel(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(textMinusControls(l));
    const aria = el.getAttribute('aria-label');
    if (aria) parts.push(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach(id => { const n = byId(el, id); if (n) parts.push(n.textContent); });
    if (el.placeholder) parts.push(el.placeholder);
    if (el.title) parts.push(el.title);
    return clean(parts.join(' ')).slice(0, 200);
  }

  function attrText(el) {
    return [el.name, el.id, el.getAttribute('data-automation-id'), el.getAttribute('data-qa')]
      .filter(Boolean).join(' ');
  }

  function groupOf(el) {
    if (el.type !== 'radio' || !el.name) return [el];
    const root = el.form || el.getRootNode();
    return [...root.querySelectorAll('input[type="radio"]')].filter(r => r.name === el.name);
  }

  // The question a field sits under: a legend, or the nearest container
  // that holds only this field (or this radio group).
  function questionText(el) {
    const fs = el.closest('fieldset');
    const legend = fs && fs.querySelector('legend');
    if (legend && clean(legend.textContent)) return clean(legend.textContent).slice(0, 300);

    const mine = new Set(groupOf(el));
    let best = null;
    let node = el.parentElement;
    for (let i = 0; node && i < 6; i++, node = node.parentElement) {
      const others = [...node.querySelectorAll('input:not([type=hidden]), select, textarea')]
        .filter(c => !mine.has(c));
      if (others.length) break;
      best = node;
    }
    if (!best) return '';
    let text = textMinusControls(best);
    if (el.type === 'radio') {
      // drop the option labels ("Yes", "No") so only the question remains
      for (const r of mine) for (const l of r.labels || []) {
        const lt = clean(l.textContent);
        if (lt) text = text.replace(lt, ' ');
      }
    }
    return clean(text).slice(0, 300);
  }

  function describe(el) {
    const kind = kindOf(el);
    const primary = kind === 'radio' ? '' : primaryLabel(el);
    const question = questionText(el);
    const attrs = attrText(el);
    const sigBase = norm(kind === 'radio' ? (question || el.name) : (primary || question || attrs));
    return { el, kind, primary, question, attrs, sig: sigBase ? kind + '|' + sigBase.slice(0, 120) : '' };
  }

  // ---------- deciding what goes in ----------

  function ruleKey(text) {
    const t = norm(text);
    if (!t) return null;
    for (const [key, re, unless] of RULES) if (re.test(t) && !(unless && unless.test(t))) return key;
    return null;
  }

  function customAnswer(text, custom) {
    const t = norm(text);
    let best = null, bestScore = 0;
    for (const c of custom) {
      for (const phrase of c.q.split(',').map(norm).filter(Boolean)) {
        const words = phrase.split(' ');
        const hit = words.every(w => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t));
        if (hit && words.length > bestScore) { best = c; bestScore = words.length; }
      }
    }
    return best ? best.a : null;
  }

  function decide(d, ctx) {
    if (ctx.site[d.sig] != null) return { value: ctx.site[d.sig], source: 'site' };

    const ac = (d.el.getAttribute('autocomplete') || '').trim().split(/\s+/).pop();
    if (AUTOCOMPLETE[ac]) {
      const v = valueFor(AUTOCOMPLETE[ac], ctx.profile);
      if (v) return { value: v, source: 'profile', key: AUTOCOMPLETE[ac] };
    }

    const custom = customAnswer(d.primary + ' ' + d.question, ctx.custom);
    if (custom) return { value: custom, source: 'custom' };

    const isChoice = d.kind === 'radio' || d.kind === 'checkbox';
    const candidates = isChoice ? [d.question] : [d.primary, d.attrs, d.question.length < 200 ? d.question : ''];
    for (const text of candidates) {
      const key = ruleKey(text);
      if (!key) continue;
      if (d.kind === 'checkbox') return null; // never tick boxes on a guess
      const v = valueFor(key, ctx.profile);
      return v ? { value: v, source: 'profile', key } : null;
    }
    return null;
  }

  // ---------- writing values ----------

  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function touch(el, fn) {
    try { el.focus({ preventScroll: true }); } catch {}
    fn();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.blur();
  }

  // Pick the choice that best matches a value: exact, then starts-with, then contains.
  function bestChoice(choices, value) {
    const wants = aliases(value);
    const v = norm(value);
    const yesNo = /^(yes|no)\b/.exec(v);
    const list = choices.map(c => ({ ...c, t: norm(c.text) })).filter(c => c.t);
    return list.find(c => wants.includes(c.t) || wants.includes(norm(c.value)))
      || (yesNo && list.find(c => c.t.startsWith(yesNo[1])))
      || list.find(c => wants.some(w => w.length > 1 && c.t.startsWith(w)))
      || list.find(c => wants.some(w => w.length > 3 && c.t.includes(w)))
      || null;
  }

  function apply(d, value) {
    const el = d.el;
    if (d.kind === 'select') {
      const opts = [...el.options].filter(o => !o.disabled && o.value !== '');
      const pick = bestChoice(opts.map(o => ({ text: o.text, value: o.value, o })), value);
      if (!pick) return false;
      touch(el, () => setNative(el, pick.o.value));
      return true;
    }
    if (d.kind === 'radio') {
      const radios = groupOf(el);
      const pick = bestChoice(radios.map(r => ({
        text: [...(r.labels || [])].map(l => l.textContent).join(' ') || r.value, value: r.value, r,
      })), value);
      if (!pick) return false;
      if (!pick.r.checked) pick.r.click();
      return true;
    }
    if (d.kind === 'checkbox') {
      const on = /^(yes|true|checked|1|on)$/i.test(String(value).trim());
      if (on && !el.checked) el.click();
      return on;
    }
    let v = String(value);
    if (el.type === 'number') { v = (v.match(/-?\d+(\.\d+)?/) || [''])[0]; if (!v) return false; }
    if (el.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    if (el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength);
    touch(el, () => setNative(el, v));
    return true;
  }

  function isEmpty(d) {
    const el = d.el;
    if (d.kind === 'radio') return !groupOf(el).some(r => r.checked);
    if (d.kind === 'checkbox') return !el.checked;
    if (d.kind === 'select') {
      const o = el.options[el.selectedIndex];
      return !o || o.value === '' || /^(select|choose|please|--|-)/i.test(clean(o.text));
    }
    return !String(el.value || '').trim();
  }

  function readValue(d) {
    const el = d.el;
    if (d.kind === 'radio') {
      const r = groupOf(el).find(x => x.checked);
      return r ? clean([...(r.labels || [])].map(l => l.textContent).join(' ') || r.value) : '';
    }
    if (d.kind === 'checkbox') return el.checked ? 'checked' : '';
    if (d.kind === 'select') return isEmpty(d) ? '' : clean(el.options[el.selectedIndex].text);
    return el.value;
  }

  // Never remember answers like these, even when asked to save a page.
  const SENSITIVE = /\b(ssn|social security|social insurance|sin number|tax ?id|tin|ein|itin|date of birth|birth ?date|dob|birthday|bank|routing|account number|iban|swift|credit card|card number|cvv|cvc|security code|expir\w*|driver s? licen[cs]e|licen[cs]e number|passport|alien registration|uscis|visa number|password|passcode|pin|mother s maiden|security question|security answer)\b/;
  function isSensitive(d) {
    const ac = (d.el.getAttribute('autocomplete') || '').toLowerCase();
    if (/^cc-|bday|new-password|current-password|one-time-code/.test(ac)) return true;
    return SENSITIVE.test(norm([d.primary, d.question, d.attrs].join(' ')));
  }

  // ---------- commands ----------

  function walk(fn) {
    const seenGroups = new Set();
    for (const el of fields()) {
      if (el.type === 'radio' && el.name) {
        if (seenGroups.has(el.name)) continue;
        seenGroups.add(el.name);
      }
      fn(describe(el));
    }
  }

  async function fillPage(ctx) {
    let filled = 0, already = 0, total = 0;
    const done = [], left = [];
    walk(d => {
      if (d.el.getAttribute('role') === 'combobox' || d.el.getAttribute('aria-autocomplete') === 'list') {
        if (isEmpty(d)) left.push(d.el);
        return;
      }
      if (d.kind === 'checkbox' && !ctx.site[d.sig]) return; // ignore unsaved checkboxes entirely
      total++;
      if (!isEmpty(d)) { already++; return; }
      const choice = decide(d, ctx);
      if (choice && apply(d, choice.value)) {
        filled++;
        done.push(d.kind === 'radio' ? (groupOf(d.el).find(r => r.checked) || d.el) : d.el);
      }
      else left.push(d.el);
    });

    const traps = findTraps(ctx);
    if (!total && !left.length) {
      toast('No form fields here', 'Right-click inside the application form.', trapNote(traps));
      return { filled: 0, total: 0, traps: traps.length };
    }
    flash(done, '#1f9d55', 2500);
    flash(left, '#e08a00', 6000, 'dashed');
    const bits = [];
    if (already) bits.push(`${already} already had answers`);
    if (left.length) bits.push(`${left.length} left for you (outlined in amber)`);
    toast(filled ? `Filled ${filled} field${filled === 1 ? '' : 's'}` : 'Nothing new to fill', bits.join(' · '), trapNote(traps));
    return { filled, total, traps: traps.length };
  }

  async function scanPage(ctx) {
    const traps = findTraps(ctx);
    if (!traps.length) {
      toast('No hidden fields found', 'Nothing on this form is disguised to collect your details.');
    } else {
      const n = traps.length;
      toast(`Found ${n} hidden field${n === 1 ? '' : 's'}`,
        'Some sites use these to catch spam bots; others to collect details you can’t see. AppFill never fills them.',
        `${traps.length === 1 ? 'It asks' : 'They ask'} for your ${listWords(traps.map(t => t.asks))}.`);
      console.info('[AppFill] Hidden fields:', traps.map(t => ({ asks: t.asks, how: t.trick, field: t.el })));
    }
    return { traps: traps.length, details: traps.map(t => ({ asks: t.asks, how: t.trick })) };
  }

  async function fillOne(ctx, msg) {
    let el = lastTarget;
    if (el && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      el = el.closest && el.closest('input, textarea, select');
    }
    if (!el) return { filled: 0 };
    const value = msg.key ? valueFor(msg.key, ctx.profile)
      : ((ctx.custom.find(c => c.id === msg.customId) || {}).a || '');
    if (!value) { toast('That entry is empty', 'Add it in AppFill settings.'); return { filled: 0 }; }
    const d = describe(el);
    if (d.kind === 'text' && !el.isContentEditable) {
      // right-click fill always replaces what's there
      touch(el, () => setNative(el, el.type === 'number' ? (String(value).match(/\d+/) || [''])[0] : value));
      flash([el], '#1f9d55', 1500);
      return { filled: 1 };
    }
    const ok = apply(d, value);
    if (ok) flash([el], '#1f9d55', 1500); else toast('Couldn’t find a matching option', String(value));
    return { filled: ok ? 1 : 0 };
  }

  async function savePage() {
    const saved = {};
    let skipped = 0;
    walk(d => {
      if (!d.sig || isEmpty(d)) return;
      if (isSensitive(d)) { skipped++; return; }
      const v = readValue(d);
      if (v) saved[d.sig] = v;
    });
    const n = Object.keys(saved).length;
    if (!n) {
      toast('Nothing to save yet', skipped ? 'Private answers like ID or bank numbers are never saved.' : 'Fill in the form first, then save.');
      return { saved: 0 };
    }
    const prev = (await chrome.storage.local.get(SITE_KEY))[SITE_KEY] || { fields: {} };
    await chrome.storage.local.set({
      [SITE_KEY]: { host: location.hostname, savedAt: Date.now(), fields: { ...prev.fields, ...saved } },
    });
    toast(`Saved ${n} answer${n === 1 ? '' : 's'}`, skipped
      ? `Skipped ${skipped} private answer${skipped === 1 ? '' : 's'}. Reused on ${location.hostname}.`
      : `They’ll be reused on ${location.hostname}.`);
    return { saved: n };
  }

  async function forgetPage() {
    const had = (await chrome.storage.local.get(SITE_KEY))[SITE_KEY];
    if (!had) { toast('Nothing saved for this site'); return {}; }
    await chrome.storage.local.remove(SITE_KEY);
    toast('Forgot saved answers', location.hostname);
    return {};
  }

  // ---------- feedback ----------

  function flash(els, color, ms, style = 'solid') {
    for (const el of els) {
      const target = (el.type === 'radio' || el.type === 'checkbox') && el.labels && el.labels[0]
        ? el.labels[0] : el;
      const prev = [target.style.outline, target.style.outlineOffset];
      target.style.outline = `2px ${style} ${color}`;
      target.style.outlineOffset = '2px';
      setTimeout(() => { [target.style.outline, target.style.outlineOffset] = prev; }, ms);
    }
  }

  let toastHost = null, toastTimer = null;
  function toast(title, detail = '', warn = '') {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement('appfill-toast');
      toastHost.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(toastHost);
    }
    toastHost.shadowRoot.innerHTML = `
      <style>
        .t{position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:320px;
           font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
           background:#1d1b1a;color:#fff;border-radius:12px;padding:12px 16px 12px 14px;
           box-shadow:0 8px 28px rgba(0,0,0,.28);display:flex;gap:10px;align-items:flex-start;
           animation:in .18s ease-out}
        .dot{flex:none;width:10px;height:10px;margin-top:5px;border-radius:50%;
             background:linear-gradient(135deg,#ff6b5b,#ffb38a)}
        b{display:block;font-weight:600}
        [hidden]{display:none!important}
        span{display:block;color:#cfc9c6;font-size:13px;margin-top:2px}
        .w{display:flex;gap:7px;margin-top:8px;padding-top:8px;border-top:1px solid #3a3634;color:#ffd08a;font-size:13px}
        .w::before{content:"!";flex:none;width:16px;height:16px;border-radius:50%;background:#e08a00;color:#1d1b1a;
                   font:700 11px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;margin-top:1px}
        .t.warned .dot{background:#e08a00}
        @keyframes in{from{opacity:0;transform:translateY(6px)}}
      </style>
      <div class="t" role="status"><div class="dot"></div><div><b></b><span></span><div class="w"></div></div></div>`;
    const root = toastHost.shadowRoot;
    root.querySelector('b').textContent = title;
    root.querySelector('span').textContent = detail;
    root.querySelector('span').hidden = !detail;
    const w = root.querySelector('.w');
    if (warn) { w.textContent = warn; root.querySelector('.t').classList.add('warned'); } else w.remove();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastHost && toastHost.remove(), warn ? 10000 : 5000);
  }
})();
