import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c.PORT).toBe(8080);
    expect(c.TICK_RATE).toBe(30);
    expect(c.ALLOWED_ORIGINS).toEqual([]);
    expect(c.TRUST_PROXY).toBe(false);
  });

  it('parses and trims the origin list', () => {
    const c = loadConfig({ ALLOWED_ORIGINS: ' https://a.example , https://b.example ,, ' });
    expect(c.ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('coerces numeric strings and booleans', () => {
    const c = loadConfig({ PORT: '9000', TRUST_PROXY: 'true' });
    expect(c.PORT).toBe(9000);
    expect(c.TRUST_PROXY).toBe(true);
  });

  it('fails fast with a readable message on invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid configuration: PORT/);
    expect(() => loadConfig({ TICK_RATE: '1000' })).toThrow(/TICK_RATE/);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });
});
