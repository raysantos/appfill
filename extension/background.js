importScripts('fields.js');
const { PROFILE_FIELDS, valueFor } = globalThis.AF;

const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const { profile = {}, custom = [] } = await chrome.storage.local.get(['profile', 'custom']);
  const add = props => chrome.contextMenus.create(props, () => void chrome.runtime.lastError);
  const ALL = ['page', 'frame', 'editable', 'selection', 'link'];

  add({ id: 'fill-page', title: 'Fill this application', contexts: ALL });
  add({ id: 'scan-page', title: 'Check this form for hidden fields', contexts: ALL });
  add({ id: 'fill-field', title: 'Fill this field with…', contexts: ['editable'] });

  const entries = [
    { key: 'fullName', label: 'Full name' },
    ...PROFILE_FIELDS.filter(f => f.type !== 'yesno'),
    { key: 'location', label: 'City, State' },
  ].filter(f => valueFor(f.key, profile));

  for (const f of entries) {
    add({ id: 'key:' + f.key, parentId: 'fill-field', contexts: ['editable'],
      title: `${f.label}  —  ${trim(valueFor(f.key, profile), 28)}` });
  }
  const answers = custom.filter(c => c.q && c.a);
  if (answers.length) {
    add({ id: 'sep-custom', parentId: 'fill-field', type: 'separator', contexts: ['editable'] });
    for (const c of answers) {
      add({ id: 'custom:' + c.id, parentId: 'fill-field', contexts: ['editable'],
        title: trim(c.q.split(',')[0].trim(), 40) });
    }
  }
  if (!entries.length && !answers.length) {
    add({ id: 'empty', parentId: 'fill-field', contexts: ['editable'], enabled: false,
      title: 'Add your info in AppFill settings first' });
  }

  add({ id: 'sep-1', type: 'separator', contexts: ALL });
  add({ id: 'save-site', title: 'Remember my answers on this site', contexts: ALL });
  add({ id: 'forget-site', title: 'Forget answers for this site', contexts: ALL });
  add({ id: 'sep-2', type: 'separator', contexts: ALL });
  add({ id: 'options', title: 'AppFill settings…', contexts: ALL });
}

let rebuildTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('profile' in changes || 'custom' in changes)) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(buildMenus, 400);
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await buildMenus();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(buildMenus);

// Send to the page; if the content script isn't there yet (tab was open
// before install), inject it and try again.
async function send(tabId, msg, frameId) {
  const opts = frameId != null ? { frameId } : undefined;
  try {
    return await chrome.tabs.sendMessage(tabId, msg, opts);
  } catch {
    const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true };
    try {
      await chrome.scripting.executeScript({ target, files: ['fields.js', 'content.js'] });
      return await chrome.tabs.sendMessage(tabId, msg, opts);
    } catch (e) {
      console.warn('AppFill can’t run on this page:', e.message);
    }
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === 'options') return chrome.runtime.openOptionsPage();
  if (!tab || tab.id == null) return;
  // Only the frame you right-clicked in. Ads, chat widgets and other
  // embedded frames on the same page never receive your details.
  if (id === 'fill-page') return send(tab.id, { type: 'fillPage' }, info.frameId ?? 0);
  if (id === 'scan-page') return send(tab.id, { type: 'scanPage' }, info.frameId ?? 0);
  if (id === 'save-site') return send(tab.id, { type: 'savePage' }, info.frameId ?? 0);
  if (id === 'forget-site') return send(tab.id, { type: 'forgetPage' }, info.frameId ?? 0);
  if (id.startsWith('key:')) return send(tab.id, { type: 'fillField', key: id.slice(4) }, info.frameId);
  if (id.startsWith('custom:')) return send(tab.id, { type: 'fillField', customId: id.slice(7) }, info.frameId);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
