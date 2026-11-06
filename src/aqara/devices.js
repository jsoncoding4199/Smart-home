/**
 * Maps Aqara device models to a device type and the resource IDs used to
 * read/write state. Resource IDs follow the Aqara Open API "x.y.85" convention.
 * If one of your devices uses different IDs, check its model in the Aqara
 * developer console (Resource list) and add a rule below.
 */
export const RES = {
  power: '4.1.85',        // 0/1 relay / light on-off (channel 1)
  power2: '4.2.85',       // channel 2 on dual switches
  brightness: '14.1.85',  // 0-100
  colorTemp: '14.2.85',   // mired
  temperature: '0.1.85',  // 1/100 °C
  humidity: '0.2.85',     // 1/100 %
  pressure: '0.3.85',     // Pa
  status: '3.1.85',       // motion / contact (1=open) / leak (1=wet)
  curtain: '1.1.85',      // position 0-100
  battery: '8.0.2001',    // %
};

const RULES = [
  { test: /\.(gateway|hub|camera)/, type: 'hub', read: [], controls: [] },
  { test: /\.light|\.bulb|\.led/, type: 'light', read: ['power', 'brightness'], controls: ['power', 'brightness'] },
  { test: /\.curtain|\.blind|\.shade/, type: 'curtain', read: ['curtain', 'battery'], controls: ['curtain'] },
  { test: /\.(plug|switch|ctrl_|relay|outlet)/, type: 'switch', read: ['power'], controls: ['power'] },
  { test: /\.(sensor_ht|weather|sensor_temp|airmonitor)/, type: 'climate', read: ['temperature', 'humidity', 'pressure', 'battery'], controls: [] },
  { test: /\.(sensor_motion|motion)/, type: 'motion', read: ['status', 'battery'], controls: [] },
  { test: /\.(sensor_magnet|magnet)/, type: 'contact', read: ['status', 'battery'], controls: [] },
  { test: /\.(sensor_wleak|flood|leak)/, type: 'leak', read: ['status', 'battery'], controls: [] },
];

export function classify(model = '') {
  const m = model.toLowerCase();
  const rule = RULES.find((r) => r.test.test(m));
  return rule ? { type: rule.type, read: rule.read, controls: rule.controls } : { type: 'other', read: [], controls: [] };
}

/** Convert raw Aqara resource values to friendly units. */
export function decodeState(type, raw) {
  const num = (k) => (raw[RES[k]] === undefined ? undefined : Number(raw[RES[k]]));
  const s = {};
  const set = (k, v) => { if (v !== undefined && !Number.isNaN(v)) s[k] = v; };
  switch (type) {
    case 'switch': set('on', num('power') === undefined ? undefined : num('power') === 1); break;
    case 'light':
      set('on', num('power') === undefined ? undefined : num('power') === 1);
      set('brightness', num('brightness'));
      break;
    case 'curtain': set('position', num('curtain')); break;
    case 'climate':
      set('temperature', num('temperature') === undefined ? undefined : num('temperature') / 100);
      set('humidity', num('humidity') === undefined ? undefined : num('humidity') / 100);
      set('pressure', num('pressure') === undefined ? undefined : num('pressure') / 100); // hPa
      break;
    case 'motion': set('motion', num('status') === undefined ? undefined : num('status') === 1); break;
    case 'contact': set('open', num('status') === undefined ? undefined : num('status') === 1); break;
    case 'leak': set('leak', num('status') === undefined ? undefined : num('status') === 1); break;
  }
  set('battery', num('battery'));
  return s;
}

/** Turn a friendly command into Aqara resource writes. */
export function encodeCommand(type, command) {
  const { controls } = RULES.find((r) => r.type === type) || { controls: [] };
  const out = [];
  if ('on' in command && controls.includes('power')) out.push({ resourceId: RES.power, value: command.on ? '1' : '0' });
  if ('brightness' in command && controls.includes('brightness')) {
    out.push({ resourceId: RES.brightness, value: String(clamp(command.brightness)) });
  }
  if ('position' in command && controls.includes('curtain')) {
    out.push({ resourceId: RES.curtain, value: String(clamp(command.position)) });
  }
  if (!out.length) throw Object.assign(new Error(`Unsupported command for ${type} device`), { status: 400 });
  return out;
}

const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
