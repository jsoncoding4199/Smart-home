import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockAqara } from '../src/aqara/mock.js';
import { HomeService } from '../src/service.js';
import { classify, decodeState, encodeCommand, RES } from '../src/aqara/devices.js';

test('classify maps Aqara models to types', () => {
  assert.equal(classify('lumi.plug.maeu01').type, 'switch');
  assert.equal(classify('lumi.light.acn014').type, 'light');
  assert.equal(classify('lumi.weather.v1').type, 'climate');
  assert.equal(classify('lumi.magnet.agl02').type, 'contact');
  assert.equal(classify('lumi.curtain.acn002').type, 'curtain');
  assert.equal(classify('lumi.gateway.agl02').type, 'hub');
  assert.equal(classify('vendor.unknown').type, 'other');
});

test('decodeState converts units', () => {
  assert.deepEqual(decodeState('climate', { [RES.temperature]: '2215', [RES.humidity]: '4630', [RES.battery]: '90' }),
    { temperature: 22.15, humidity: 46.3, battery: 90 });
  assert.deepEqual(decodeState('contact', { [RES.status]: '1' }), { open: true });
});

test('encodeCommand validates and clamps', () => {
  assert.deepEqual(encodeCommand('light', { on: true, brightness: 150 }), [
    { resourceId: RES.power, value: '1' }, { resourceId: RES.brightness, value: '100' }]);
  assert.throws(() => encodeCommand('climate', { on: true }), { status: 400 });
});

test('HomeService overview and control against mock', async () => {
  const home = new HomeService(new MockAqara());
  const o = await home.overview();
  assert.ok(o.rooms.length >= 3);
  assert.ok(o.scenes.length && o.automations.length);
  const plug = o.devices.find((d) => d.id === 'lumi.plug01');
  assert.equal(plug.state.on, false);
  assert.equal((await home.control('lumi.plug01', { on: true })).state.on, true);
  await assert.rejects(home.control('nope', { on: true }), { status: 404 });
});

test('scenes and automations', async () => {
  const home = new HomeService(new MockAqara());
  await home.runScene('scene.away');
  const devices = await home.devices();
  assert.ok(devices.filter((d) => d.type === 'switch' || d.type === 'light').every((d) => !d.state.on));
  await home.setAutomation('auto.night', true);
  assert.equal((await home.automations()).find((a) => a.id === 'auto.night').enabled, true);
});
