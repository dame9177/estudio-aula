import { describe, expect, it } from 'vitest';
import { isInfrared, usableCameras, usableMics, pickDevice, humanMediaError } from '../../src/renderer/lib/device-pick.js';

const cam = (deviceId, label) => ({ kind: 'videoinput', deviceId, label });
const mic = (deviceId, label) => ({ kind: 'audioinput', deviceId, label });

describe('device picking', () => {
  it('recognizes infrared cameras (this laptop has an ASUS IR camera)', () => {
    expect(isInfrared('ASUS FHD webcam: ASUS IR camera')).toBe(true);
    expect(isInfrared('Integrated Infrared Camera')).toBe(true);
    expect(isInfrared('ASUS FHD webcam')).toBe(false);
    expect(isInfrared('Logitech BRIO')).toBe(false);
  });

  it('drops IR cameras and non-video devices', () => {
    const list = [cam('a', 'ASUS FHD webcam'), cam('b', 'ASUS IR camera'), mic('m', 'Mic')];
    expect(usableCameras(list).map((d) => d.deviceId)).toEqual(['a']);
  });

  it('hides the default alias when real microphones exist', () => {
    const list = [mic('default', 'Default'), mic('x', 'Built-in Audio Analog Stereo')];
    expect(usableMics(list).map((d) => d.deviceId)).toEqual(['x']);
    expect(usableMics([mic('default', 'Default')]).map((d) => d.deviceId)).toEqual(['default']);
  });

  it('prefers the saved device by id, then by label, then the first one', () => {
    const list = [cam('a', 'One'), cam('b', 'Two')];
    expect(pickDevice(list, { id: 'b', label: 'Two' }).deviceId).toBe('b');
    expect(pickDevice(list, { id: 'zzz', label: 'Two' }).deviceId).toBe('b');
    expect(pickDevice(list, { id: 'zzz', label: 'Gone' }).deviceId).toBe('a');
    expect(pickDevice(list, null).deviceId).toBe('a');
    expect(pickDevice([], null)).toBe(null);
  });

  it('explains errors in plain Portuguese', () => {
    expect(humanMediaError({ name: 'NotReadableError' }, 'video')).toMatch(/outro programa/);
    expect(humanMediaError({ name: 'NotFoundError' }, 'audio')).toMatch(/Não encontrei o microfone/);
    expect(humanMediaError({ name: 'NotAllowedError' }, 'video')).toMatch(/bloqueou a câmera/);
  });
});
