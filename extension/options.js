const { PROFILE_FIELDS } = globalThis.AF;
const $ = s => document.querySelector(s);
let profile = {}, custom = [];

function flashStatus(text) {
  const s = $('#status');
  s.textContent = text;
  s.style.opacity = 1;
  clearTimeout(flashStatus.t);
  flashStatus.t = setTimeout(() => (s.style.opacity = 0), 1500);
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ profile, custom });
    flashStatus('Saved');
  }, 300);
}

function renderProfile() {
  const form = $('#profile');
  form.innerHTML = '';
  const groups = [...new Set(PROFILE_FIELDS.map(f => f.group))];
  for (const g of groups) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `<div class="card-head"><div><h2></h2></div></div><div class="grid"></div>`;
    card.querySelector('h2').textContent = g;
    const grid = card.querySelector('.grid');
    for (const f of PROFILE_FIELDS.filter(x => x.group === g)) {
      const label = document.createElement('label');
      label.innerHTML = '<span></span>';
      label.firstChild.textContent = f.label;
      let input;
      if (f.type === 'yesno') {
        input = document.createElement('select');
        for (const [v, t] of [['', '—'], ['Yes', 'Yes'], ['No', 'No']]) input.add(new Option(t, v));
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
        if (f.hint) input.placeholder = f.hint;
      }
      input.value = profile[f.key] || '';
      input.addEventListener('input', () => { profile[f.key] = input.value.trim(); save(); });
      label.appendChild(input);
      grid.appendChild(label);
    }
    form.appendChild(card);
  }
}

function renderCustom() {
  const list = $('#customList');
  list.innerHTML = '';
  for (const c of custom) {
    const row = $('#customTpl').content.firstElementChild.cloneNode(true);
    const q = row.querySelector('.q'), a = row.querySelector('.a');
    q.value = c.q || '';
    a.value = c.a || '';
    q.addEventListener('input', () => { c.q = q.value; save(); });
    a.addEventListener('input', () => { c.a = a.value; save(); });
    row.querySelector('.remove').addEventListener('click', () => {
      custom = custom.filter(x => x !== c);
      renderCustom();
      save();
    });
    list.appendChild(row);
  }
  $('#customEmpty').hidden = custom.length > 0;
}

async function renderSites() {
  const all = await chrome.storage.local.get(null);
  const sites = Object.entries(all).filter(([k]) => k.startsWith('site:'))
    .sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
  const ul = $('#sites');
  ul.innerHTML = '';
  for (const [key, s] of sites) {
    const li = document.createElement('li');
    const n = Object.keys(s.fields || {}).length;
    li.innerHTML = `<div><strong></strong><br><small></small></div><button class="btn" type="button">Forget</button>`;
    li.querySelector('strong').textContent = s.host || key.slice(5);
    li.querySelector('small').textContent =
      `${n} answer${n === 1 ? '' : 's'} · saved ${new Date(s.savedAt).toLocaleDateString()}`;
    li.querySelector('button').addEventListener('click', async () => {
      await chrome.storage.local.remove(key);
      renderSites();
    });
    ul.appendChild(li);
  }
  $('#sitesEmpty').hidden = sites.length > 0;
}

$('#addCustom').addEventListener('click', () => {
  custom.push({ id: Math.random().toString(36).slice(2, 10), q: '', a: '' });
  renderCustom();
  $('#customList .custom:last-child .q').focus();
});

$('#export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify({ appfill: 1, ...data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `appfill-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.appfill) throw new Error('Not an AppFill backup');
    delete data.appfill;
    await chrome.storage.local.set(data);
    await load();
    flashStatus('Imported');
  } catch (err) {
    alert('Couldn’t import that file: ' + err.message);
  }
  e.target.value = '';
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(k => k.startsWith('site:'))) renderSites();
});

async function load() {
  const data = await chrome.storage.local.get(['profile', 'custom']);
  profile = data.profile || {};
  custom = data.custom || [];
  renderProfile();
  renderCustom();
  renderSites();
}
load();
