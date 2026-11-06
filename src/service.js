import { classify, decodeState, encodeCommand, RES } from './aqara/devices.js';

const PAGE = 100;

/** High-level home model on top of an Aqara backend (real client or mock). */
export class HomeService {
  constructor(api) {
    this.api = api;
  }

  async #all(intent, data = {}) {
    const out = [];
    for (let pageNum = 1; ; pageNum++) {
      const r = await this.api.call(intent, { ...data, pageNum, pageSize: PAGE });
      const items = r?.data || [];
      out.push(...items);
      if (!items.length || out.length >= (r.totalCount ?? out.length)) return out;
    }
  }

  async rooms() {
    const list = await this.#all('query.position.info', { parentPositionId: '' });
    return list.map((p) => ({ id: p.positionId, name: p.positionName }));
  }

  async devices() {
    const raw = await this.#all('query.device.info', { dids: [], positionId: '' });
    const devices = raw.map((d) => ({
      id: d.did,
      name: d.deviceName || d.did,
      model: d.model,
      roomId: d.positionId,
      online: d.state === undefined ? true : d.state === 1,
      ...classify(d.model),
    }));

    // Batch-read state for every readable device in one call.
    const resources = devices
      .filter((d) => d.read.length)
      .map((d) => ({ subjectId: d.id, resourceIds: d.read.map((k) => RES[k]) }));
    const values = resources.length ? await this.api.call('query.resource.value', { resources }) : [];
    const byDevice = {};
    for (const v of values || []) (byDevice[v.subjectId] ||= {})[v.resourceId] = v.value;

    return devices.map(({ read, ...d }) => ({ ...d, state: decodeState(d.type, byDevice[d.id] || {}) }));
  }

  async device(id) {
    const all = await this.devices();
    const dev = all.find((d) => d.id === id);
    if (!dev) throw Object.assign(new Error(`Unknown device ${id}`), { status: 404 });
    return dev;
  }

  async control(id, command) {
    const dev = await this.device(id);
    const resources = encodeCommand(dev.type, command);
    await this.api.call('write.resource.device', [{ subjectId: id, resources }]);
    return this.device(id);
  }

  async scenes() {
    const list = await this.#all('query.scene.listByPositionId', { positionId: '' });
    return list.map((s) => ({ id: s.sceneId, name: s.name, roomId: s.positionId }));
  }

  runScene(id) {
    return this.api.call('config.scene.run', { sceneId: id });
  }

  async automations() {
    const list = await this.#all('query.ifttt.list', { positionId: '' });
    return list.map((a) => ({ id: a.linkageId, name: a.name, roomId: a.positionId, enabled: Number(a.enable) === 1 }));
  }

  setAutomation(id, enabled) {
    return this.api.call('config.ifttt.state', { linkageId: id, state: enabled ? 1 : 0 });
  }

  /** Everything the dashboard needs in one round trip. */
  async overview() {
    const [rooms, devices, scenes, automations] = await Promise.all([this.rooms(), this.devices(), this.scenes(), this.automations()]);
    return { rooms, devices, scenes, automations, updatedAt: new Date().toISOString() };
  }
}
