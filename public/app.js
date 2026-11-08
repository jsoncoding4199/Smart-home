const $ = (s) => document.querySelector(s);
const POLL_MS = 10_000;
const ICONS = { light: '💡', switch: '🔌', curtain: '🪟', climate: '🌡️', motion: '🚶', contact: '🚪', leak: '💧', hub: '📡', other: '⚙️' };

const state = { data: null, room: 'all', token: localStorage.getItem('dashboardToken') || '' };

async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(state.token && { Authorization: `Bearer ${state.token}` }) },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401 && !path.startsWith('auth')) {
    const data = await res.json().catch(() => ({}));
    if (data.error === 'Unauthorized') {
      const t = prompt('Dashboard token');
      if (t) { state.token = t; localStorage.setItem('dashboardToken', t); return api(path, body); }
    }
    throw Object.assign(new Error(data.error || 'Unauthorized'), { status: 401 });
  }
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...children.flat().filter((c) => c != null));
  return n;
}

// ---- rendering --------------------------------------------------------------

function render() {
  const { rooms, devices, scenes, automations } = state.data;
  const roomName = Object.fromEntries(rooms.map((r) => [r.id, r.name]));

  const visible = devices.filter((d) => d.type !== 'hub');
  const on = visible.filter((d) => d.state.on).length;
  const alerts = devices.filter(isAlert).length;
  $('#summary').textContent = `${visible.length} devices · ${on} on${alerts ? ` · ⚠️ ${alerts} alert${alerts > 1 ? 's' : ''}` : ''}`;

  $('#scenes').hidden = !scenes.length;
  $('#scenes').replaceChildren(...scenes.map((s) => el('button', { class: 'chip', onclick: (e) => runScene(s, e.currentTarget) }, `▶ ${s.name}`)));

  const tabs = [{ id: 'all', name: 'All' }, ...rooms.filter((r) => devices.some((d) => d.roomId === r.id))];
  $('#rooms').replaceChildren(...tabs.map((r) => el('button', {
    'aria-selected': String(state.room === r.id),
    onclick: () => { state.room = r.id; render(); },
  }, r.name)));

  // Hubs carry no useful state; sensors go in a compact strip below the controls.
  const shown = devices.filter((d) => d.type !== 'hub' && (state.room === 'all' || d.roomId === state.room));
  const showRoom = state.room === 'all';
  $('#devices').replaceChildren(...shown.filter(isControl).map((d) => deviceCard(d, showRoom && roomName[d.roomId])));
  $('#sensors').replaceChildren(...shown.filter((d) => !isControl(d)).map((d) => sensorTile(d, showRoom && roomName[d.roomId])));

  const enabled = automations.filter((a) => a.enabled).length;
  $('#automations-count').textContent = automations.length ? `${enabled}/${automations.length} on` : '';
  $('#automations').replaceChildren(...(automations.length
    ? automations.map((a) => el('li', {},
        el('div', {}, el('div', {}, a.name), el('div', { class: 'meta muted' }, roomName[a.roomId] || '')),
        toggle(a.enabled, `Enable ${a.name}`, (v) => setAutomation(a, v))))
    : [el('li', { class: 'muted' }, 'No automations')]));
}

const CONTROL_TYPES = ['light', 'switch', 'curtain'];
const isControl = (d) => CONTROL_TYPES.includes(d.type);
const lowBattery = (d) => d.state.battery !== undefined && d.state.battery < 20;

function isAlert(d) {
  return d.state.leak === true || lowBattery(d);
}

function toggle(checked, label, onChange) {
  return el('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label,
    onclick: (e) => onChange(e.currentTarget.getAttribute('aria-checked') !== 'true'),
  });
}

function meta(d, room) {
  // Only show what needs attention: battery when low, offline when offline.
  return [room, !d.online && 'offline', lowBattery(d) && `🔋 ${d.state.battery}%`].filter(Boolean).join(' · ');
}

function deviceCard(d, room) {
  const s = d.state;
  const cls = ['card', s.on && 'on', isAlert(d) && 'alert', !d.online && 'offline'].filter(Boolean).join(' ');
  let slider = null;
  let extra = null;

  if (d.type === 'curtain') {
    extra = el('div', { class: 'value' }, `${s.position ?? '–'}%`);
    slider = el('input', {
      type: 'range', min: 0, max: 100, value: s.position ?? 0, 'aria-label': `${d.name} position`,
      onchange: (e) => controlDevice(d, { position: Number(e.target.value) }),
    });
  } else {
    extra = toggle(s.on, `Toggle ${d.name}`, (v) => controlDevice(d, { on: v }));
    if (d.type === 'light' && s.brightness !== undefined) {
      slider = el('input', {
        type: 'range', min: 1, max: 100, value: s.brightness, 'aria-label': `${d.name} brightness`,
        onchange: (e) => controlDevice(d, { brightness: Number(e.target.value), on: true }),
      });
    }
  }
  const m = meta(d, room);
  return el('article', { class: cls },
    el('header', {},
      el('div', { class: 'title' },
        el('span', { class: 'icon', 'aria-hidden': 'true' }, ICONS[d.type] || ICONS.other),
        el('div', {}, el('h3', {}, d.name), m ? el('div', { class: 'meta' }, m) : null)),
      extra),
    slider);
}

function sensorReading(d) {
  const s = d.state;
  switch (d.type) {
    case 'climate':
      return [s.temperature !== undefined ? `${s.temperature.toFixed(1)}°` : '–',
        s.humidity !== undefined ? el('small', {}, `${Math.round(s.humidity)}%`) : null];
    case 'motion': return s.motion ? 'Motion' : 'Clear';
    case 'contact': return s.open ? 'Open' : 'Closed';
    case 'leak': return s.leak ? 'Leak!' : 'Dry';
    default: return d.model;
  }
}

function sensorTile(d, room) {
  const cls = ['tile', isAlert(d) && 'alert', !d.online && 'offline', (d.state.open || d.state.motion) && 'active'].filter(Boolean).join(' ');
  const m = meta(d, room);
  return el('div', { class: cls },
    el('span', { class: 'icon', 'aria-hidden': 'true' }, ICONS[d.type] || ICONS.other),
    el('div', { class: 'tile-body' },
      el('div', { class: 'tile-name' }, d.name),
      m ? el('div', { class: 'meta' }, m) : null),
    el('div', { class: 'tile-value' }, sensorReading(d)));
}

// ---- actions ----------------------------------------------------------------

async function controlDevice(d, command) {
  try {
    const updated = await api(`devices/${encodeURIComponent(d.id)}`, command);
    Object.assign(d, updated);
    render();
  } catch (e) { toast(`${d.name}: ${e.message}`); }
}

async function runScene(s, btn) {
  btn.disabled = true;
  try { await api(`scenes/${encodeURIComponent(s.id)}/run`, {}); toast(`Ran “${s.name}”`); await refresh(); }
  catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
}

async function setAutomation(a, enabled) {
  try { await api(`automations/${encodeURIComponent(a.id)}`, { enabled }); a.enabled = enabled; render(); }
  catch (e) { toast(e.message); }
}

async function refresh() {
  try {
    state.data = await api('overview');
    $('#home').hidden = false;
    $('#login').hidden = true;
    render();
  } catch (e) {
    if (e.status === 401) showLogin();
    else toast(`Refresh failed: ${e.message}`);
  }
}

function showLogin() {
  $('#login').hidden = false;
  $('#home').hidden = true;
  $('#summary').textContent = 'Not connected';
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('auth/code', { account: $('#account').value.trim() });
    $('#code-form').hidden = false;
    toast('Code sent — check your Aqara app, SMS or email');
  } catch (err) { toast(err.message); }
});

$('#code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('auth/token', { account: $('#account').value.trim(), code: $('#code').value.trim() });
    toast('Connected to Aqara');
    await refresh();
  } catch (err) { toast(err.message); }
});

(async function init() {
  const status = await api('status').catch(() => null);
  if (status) {
    $('#mode').textContent = status.mode === 'demo' ? 'Demo mode' : `Aqara · ${status.region.toUpperCase()}`;
    if (status.account) $('#account').value = status.account;
    if (!status.loggedIn) return showLogin();
  }
  await refresh();
  setInterval(() => { if (!document.hidden && !$('#home').hidden) refresh(); }, POLL_MS);
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
