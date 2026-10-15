import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime, setLocale } from './strings';

describe('date and time formatting', () => {
  const at = new Date(2026, 9, 5, 9, 7, 30).getTime(); // 5 Oct 2026, 09:07:30 local time

  afterEach(() => setLocale('zh'));

  it('follows the game language, not the device', () => {
    setLocale('zh');
    expect(formatDateTime(at)).toBe('2026/10/5 09:07');
    setLocale('en');
    expect(formatDateTime(at)).toBe('Oct 5, 2026 09:07');
  });

  it('always gives a 24-hour HH:mm time', () => {
    expect(formatTime(at)).toBe('09:07');
    expect(formatTime(new Date(2026, 0, 1, 21, 0).getTime())).toBe('21:00');
    expect(formatDate(new Date(2026, 0, 1).toISOString())).toBe('2026/1/1');
  });
});
