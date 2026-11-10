import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeMock } from './chrome-mock.js';
import { SCHEMA_VERSION, createDefaultState } from '../../src/lib/defaults.js';
import { ImportError, buildExport, loadState, migrate, normalizeState, parseImport, updateState } from '../../src/lib/store.js';

let chrome;
beforeEach(() => {
  chrome = installChromeMock();
});

describe('normalizeState', () => {
  it('fills defaults for empty storage', () => {
    expect(normalizeState({})).toEqual({ ...createDefaultState(), schedule: expect.any(Object) });
  });

  it('drops invalid rules, dedupes and re-normalises values', () => {
    const s = normalizeState({
      rules: [
        { id: 'a', type: 'domain', value: 'WWW.Reddit.com' },
        { id: 'b', type: 'domain', value: 'reddit.com' },
        { id: 'c', type: 'nonsense', value: 'x.com' },
        { id: 'd', type: 'domain', value: 'not valid' },
        { type: 'keyword', value: 'poker', enabled: false },
        'garbage',
      ],
    });
    expect(s.rules.map((r) => [r.type, r.value, r.enabled])).toEqual([
      ['domain', 'reddit.com', true],
      ['keyword', 'poker', false],
    ]);
    expect(s.rules[1].id).toBeTruthy();
  });

  it('allowlist only accepts domains', () => {
    const s = normalizeState({ allowlist: [{ type: 'keyword', value: 'abc' }, { type: 'domain', value: 'github.com' }] });
    expect(s.allowlist.map((r) => r.value)).toEqual(['github.com']);
  });

  it('clamps settings and ignores wrong types and unknown keys', () => {
    const s = normalizeState({
      settings: { mode: 'weird', theme: 'neon', focusMinutes: 99999, enabled: 'yes', bogus: 1, tempAccess: { delaySeconds: -4, minutes: 'x' } },
    });
    expect(s.settings.mode).toBe('block');
    expect(s.settings.theme).toBe('system');
    expect(s.settings.focusMinutes).toBe(600);
    expect(s.settings.enabled).toBe(true);
    expect(s.settings).not.toHaveProperty('bogus');
    expect(s.settings.tempAccess).toEqual({ enabled: true, delaySeconds: 0, minutes: 5 });
  });

  it('disables a schedule with no valid windows', () => {
    const s = normalizeState({ schedule: { enabled: true, windows: [{ days: [], start: 'x', end: 'y' }] } });
    expect(s.schedule).toEqual({ enabled: false, windows: [] });
  });
});

describe('migrate', () => {
  it('imports v1 sync blockedSites once and removes them', async () => {
    chrome.storage.sync._reset({ blockedSites: ['facebook.com', 'www.facebook.com', 'youtube', 'not a site', 'x.com'] });
    const res = await migrate();
    expect(res).toEqual({ migrated: true, imported: 2 });
    const state = await loadState();
    expect(state.rules.map((r) => r.value).sort()).toEqual(['facebook.com', 'x.com']);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(chrome.storage.sync._dump()).toEqual({});
    expect(await migrate()).toEqual({ migrated: false, imported: 0 });
  });

  it('initialises a fresh install', async () => {
    await migrate();
    expect(chrome.storage.local._dump().schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('updateState', () => {
  it('writes only when a patch is returned', async () => {
    await updateState(() => null);
    expect(chrome.storage.local._dump()).toEqual({});
    const s = await updateState(() => ({ pause: { until: 5 } }));
    expect(s.pause).toEqual({ until: 5 });
    expect(chrome.storage.local._dump()).toEqual({ pause: { until: 5 } });
  });
});

describe('import / export', () => {
  it('round-trips an export', () => {
    const state = normalizeState({
      rules: [{ type: 'domain', value: 'a.com' }],
      allowlist: [{ type: 'domain', value: 'b.com' }],
      settings: { mode: 'allow' },
    });
    const exported = JSON.stringify(buildExport(state));
    const parsed = parseImport(exported);
    expect(parsed.rules.map((r) => r.value)).toEqual(['a.com']);
    expect(parsed.allowlist.map((r) => r.value)).toEqual(['b.com']);
    expect(parsed.settings.mode).toBe('allow');
  });

  it('accepts a plain array of sites', () => {
    expect(parseImport('["a.com", "b.com", "???"]').rules.map((r) => r.value)).toEqual(['a.com', 'b.com']);
  });

  it('rejects invalid input', () => {
    expect(() => parseImport('{not json')).toThrow(ImportError);
    expect(() => parseImport({ app: 'other', data: {} })).toThrow(ImportError);
    expect(() => parseImport('42')).toThrow(ImportError);
  });
});
