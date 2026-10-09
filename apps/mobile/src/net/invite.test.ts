import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Linking: {}, Platform: { OS: 'web' }, Share: {} }));
vi.mock('../config', () => ({ SERVER_HTTP: 'https://mj.example.com' }));

const { roomFromUrl } = await import('./invite');

describe('invite links', () => {
  it.each([
    ['sichuanmahjong://join/123456', '123456'],
    ['https://play.example.com/?room=654321', '654321'],
    ['https://play.example.com/?lang=zh&room=111222', '111222'],
    ['https://mj.example.com/join/333444?lang=en', '333444'],
    ['https://play.example.com/', null],
    ['sichuanmahjong://join/12345', null],
    [null, null],
  ])('%s → %s', (url, code) => {
    expect(roomFromUrl(url)).toBe(code);
  });
});
