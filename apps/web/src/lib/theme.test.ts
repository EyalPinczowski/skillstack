import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readTheme, saveTheme } from './theme';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('defaults to following the device', () => {
    expect(readTheme()).toBe('system');
  });

  it('round-trips a manual choice and forgets it when set back to the device', () => {
    saveTheme('dark');
    expect(readTheme()).toBe('dark');
    saveTheme('system');
    expect(readTheme()).toBe('system');
  });

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem('skillstack.theme', 'neon');
    expect(readTheme()).toBe('system');
  });

  it('sets data-theme for a manual choice and removes it for the device default', () => {
    applyTheme('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    applyTheme('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    applyTheme('system');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('still works when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(readTheme()).toBe('system');
    expect(() => saveTheme('dark')).not.toThrow();
  });
});
