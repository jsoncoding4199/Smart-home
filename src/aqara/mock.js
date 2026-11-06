import { RES } from './devices.js';

/**
 * In-memory stand-in for the Aqara cloud. Implements the same `call(intent, data)`
 * contract as AqaraClient so the rest of the app is identical in demo mode.
 */
export class MockAqara {
  constructor() {
    this.positions = [
      { positionId: 'pos.living', positionName: 'Living Room' },
      { positionId: 'pos.bedroom', positionName: 'Bedroom' },
      { positionId: 'pos.kitchen', positionName: 'Kitchen' },
      { positionId: 'pos.entry', positionName: 'Entrance' },
    ];
    const d = (did, deviceName, model, positionId, values) => ({ did, deviceName, model, positionId, state: 1, values });
    this.devices = [
      d('lumi.hub01', 'Hub M2', 'lumi.gateway.agl02', 'pos.living', {}),
      d('lumi.light01', 'Ceiling Light', 'lumi.light.acn014', 'pos.living', { [RES.power]: '1', [RES.brightness]: '70' }),
      d('lumi.plug01', 'TV Plug', 'lumi.plug.maeu01', 'pos.living', { [RES.power]: '0' }),
      d('lumi.curtain01', 'Living Curtain', 'lumi.curtain.acn002', 'pos.living', { [RES.curtain]: '100', [RES.battery]: '88' }),
      d('lumi.ht01', 'Living Climate', 'lumi.weather.v1', 'pos.living', { [RES.temperature]: '2215', [RES.humidity]: '4630', [RES.pressure]: '101320', [RES.battery]: '92' }),
      d('lumi.light02', 'Bedside Lamp', 'lumi.light.cwopcn02', 'pos.bedroom', { [RES.power]: '0', [RES.brightness]: '40' }),
      d('lumi.ht02', 'Bedroom Climate', 'lumi.sensor_ht.agl02', 'pos.bedroom', { [RES.temperature]: '2040', [RES.humidity]: '5110', [RES.battery]: '75' }),
      d('lumi.switch01', 'Kitchen Switch', 'lumi.switch.n1aeu1', 'pos.kitchen', { [RES.power]: '1' }),
      d('lumi.leak01', 'Sink Leak Sensor', 'lumi.flood.agl02', 'pos.kitchen', { [RES.status]: '0', [RES.battery]: '97' }),
      d('lumi.door01', 'Front Door', 'lumi.magnet.agl02', 'pos.entry', { [RES.status]: '0', [RES.battery]: '81' }),
      d('lumi.motion01', 'Hallway Motion', 'lumi.motion.agl04', 'pos.entry', { [RES.status]: '0', [RES.battery]: '64' }),
    ];
    this.scenes = [
      { sceneId: 'scene.movie', name: 'Movie Night', positionId: 'pos.living',
        actions: [['lumi.light01', RES.power, '1'], ['lumi.light01', RES.brightness, '15'], ['lumi.plug01', RES.power, '1'], ['lumi.curtain01', RES.curtain, '0']] },
      { sceneId: 'scene.away', name: 'Leave Home', positionId: 'pos.entry',
        actions: [['lumi.light01', RES.power, '0'], ['lumi.light02', RES.power, '0'], ['lumi.plug01', RES.power, '0'], ['lumi.switch01', RES.power, '0']] },
      { sceneId: 'scene.morning', name: 'Good Morning', positionId: 'pos.bedroom',
        actions: [['lumi.light02', RES.power, '1'], ['lumi.light02', RES.brightness, '80'], ['lumi.curtain01', RES.curtain, '100']] },
    ];
    this.automations = [
      { linkageId: 'auto.hall', name: 'Hallway light on motion', positionId: 'pos.entry', enable: 1 },
      { linkageId: 'auto.leak', name: 'Alert on kitchen leak', positionId: 'pos.kitchen', enable: 1 },
      { linkageId: 'auto.night', name: 'Lights off at 23:30', positionId: 'pos.living', enable: 0 },
    ];
    this.startedAt = Date.now();
  }

  /** Small drift so the demo feels alive. */
  tick() {
    const t = (Date.now() - this.startedAt) / 60000;
    const ht = this.devices.find((x) => x.did === 'lumi.ht01');
    ht.values[RES.temperature] = String(Math.round(2215 + Math.sin(t) * 40));
    const motion = this.devices.find((x) => x.did === 'lumi.motion01');
    motion.values[RES.status] = Math.random() < 0.15 ? '1' : '0';
  }

  async call(intent, data = {}) {
    const page = (list) => {
      const pageNum = data.pageNum || 1, pageSize = data.pageSize || 50;
      return { data: list.slice((pageNum - 1) * pageSize, pageNum * pageSize), totalCount: list.length };
    };
    const strip = ({ values, actions, ...rest }) => rest;
    switch (intent) {
      case 'query.position.info':
        return page(this.positions);
      case 'query.device.info': {
        let list = this.devices;
        if (data.dids?.length) list = list.filter((x) => data.dids.includes(x.did));
        if (data.positionId) list = list.filter((x) => x.positionId === data.positionId);
        return page(list.map(strip));
      }
      case 'query.resource.value':
        this.tick();
        return (data.resources || []).flatMap(({ subjectId, resourceIds }) => {
          const dev = this.byId(subjectId);
          return resourceIds.filter((r) => r in dev.values).map((resourceId) => ({ subjectId, resourceId, value: dev.values[resourceId], timeStamp: Date.now() }));
        });
      case 'write.resource.device':
        for (const { subjectId, resources } of data) {
          const dev = this.byId(subjectId);
          for (const { resourceId, value } of resources) dev.values[resourceId] = String(value);
        }
        return null;
      case 'query.scene.listByPositionId':
        return page(this.scenes.filter((s) => !data.positionId || s.positionId === data.positionId).map(strip));
      case 'config.scene.run': {
        const scene = this.scenes.find((s) => s.sceneId === data.sceneId);
        if (!scene) throw notFound(`scene ${data.sceneId}`);
        for (const [did, rid, v] of scene.actions) this.byId(did).values[rid] = v;
        return null;
      }
      case 'query.ifttt.list':
        return page(this.automations.filter((a) => !data.positionId || a.positionId === data.positionId));
      case 'config.ifttt.state': {
        const a = this.automations.find((x) => x.linkageId === data.linkageId);
        if (!a) throw notFound(`automation ${data.linkageId}`);
        a.enable = Number(data.state);
        return null;
      }
      default:
        throw Object.assign(new Error(`Mock does not implement intent ${intent}`), { status: 501 });
    }
  }

  byId(did) {
    const dev = this.devices.find((x) => x.did === did);
    if (!dev) throw notFound(`device ${did}`);
    return dev;
  }
}

const notFound = (what) => Object.assign(new Error(`Unknown ${what}`), { status: 404 });
