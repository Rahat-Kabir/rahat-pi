import { describe, expect, it } from 'vitest';
import { fixedUtcOffsetMs, localDay } from '../src/timezone.js';
import { configFromEnv } from '../src/config.js';

const hourMs = 3600000;

describe('owner timezone and name', () => {
  it('reads fixed UTC offsets, including inverted Etc/GMT names and half hours', () => {
    expect(fixedUtcOffsetMs('UTC')).toBe(0);
    expect(fixedUtcOffsetMs('Asia/Tokyo')).toBe(9 * hourMs);
    expect(fixedUtcOffsetMs('Etc/GMT-6')).toBe(6 * hourMs);
    expect(fixedUtcOffsetMs('Asia/Kolkata')).toBe(5.5 * hourMs);
    expect(fixedUtcOffsetMs('America/Lima')).toBe(-5 * hourMs);
  });

  it('refuses daylight-saving and unknown timezones', () => {
    expect(() => fixedUtcOffsetMs('America/New_York')).toThrow('daylight saving');
    expect(() => fixedUtcOffsetMs('Not/AZone')).toThrow('Unknown timezone');
  });

  it('dates a timestamp by the local calendar day', () => {
    const lateUtcEvening = Date.parse('2026-10-24T20:00:00Z');
    expect(localDay(lateUtcEvening, 'UTC')).toBe('2026-10-24');
    expect(localDay(lateUtcEvening, 'Asia/Tokyo')).toBe('2026-10-25');
  });

  it('defaults to a neutral owner and UTC, and validates the timezone at startup', () => {
    const defaults = configFromEnv({});
    expect(defaults.ownerName).toBe('Owner');
    expect(defaults.timezone).toBe('UTC');
    const configured = configFromEnv({ RAHAT_PI_OWNER_NAME: ' Ada ', RAHAT_PI_TIMEZONE: 'Asia/Tokyo' });
    expect(configured.ownerName).toBe('Ada');
    expect(configured.timezone).toBe('Asia/Tokyo');
    expect(() => configFromEnv({ RAHAT_PI_TIMEZONE: 'Europe/Berlin' })).toThrow('daylight saving');
  });
});
