import { describe, it, expect } from 'vitest';
import {
  PROGRESS_SCHEMA_VERSION,
  PROGRESS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  clearStoredData,
  createMemoryStorage,
  getDefaultProgress,
  getDefaultSettings,
  loadProgress,
  loadSettings,
  sanitizeProgress,
  saveProgress,
  saveSettings,
} from '../src/storage/persistence';
import type { Progress } from '../src/storage/persistence';

describe('存档 key 与 schema 版本', () => {
  it('使用新的足球经理题材 key 与 schema v2', () => {
    expect(PROGRESS_STORAGE_KEY).toBe('manager-repair-shop.progress.v2');
    expect(SETTINGS_STORAGE_KEY).toBe('manager-repair-shop.settings.v1');
    expect(PROGRESS_SCHEMA_VERSION).toBe(2);

    const progress = getDefaultProgress();
    expect(progress.schemaVersion).toBe(2);
    expect(progress.completedLevels).toEqual([]);
    expect(progress.unlockedMechanisms).toEqual([]);
    expect(progress.currentLevel).toBeNull();
    expect(progress.levelStates).toEqual({});
    expect(progress.completedAt).toEqual({});
  });

  it('空存储不产生警告', () => {
    const storage = createMemoryStorage();
    expect(loadProgress(storage)).toEqual({ progress: getDefaultProgress(), warning: null });
    expect(loadSettings(storage)).toEqual({ settings: getDefaultSettings(), warning: null });
  });
});

describe('进度保存与读取', () => {
  it('保存后可以完整读回，且始终写入 schemaVersion=2', () => {
    const storage = createMemoryStorage();
    const progress: Progress = {
      ...getDefaultProgress(),
      schemaVersion: 99,
      completedLevels: ['tactics'],
      unlockedMechanisms: ['tactics-shapes'],
      currentLevel: 'scouting',
      lastSavedAt: '2026-10-18T12:00:00.000Z',
      levelStates: { scouting: { round: 1 } },
      completedAt: { tactics: '2026-10-18T11:00:00.000Z' },
    };

    const result = saveProgress(progress, storage);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    const raw = storage.getItem(PROGRESS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).schemaVersion).toBe(PROGRESS_SCHEMA_VERSION);

    const loaded = loadProgress(storage);
    expect(loaded.warning).toBeNull();
    expect(loaded.progress.completedLevels).toEqual(['tactics']);
    expect(loaded.progress.unlockedMechanisms).toEqual(['tactics-shapes']);
    expect(loaded.progress.currentLevel).toBe('scouting');
    expect(loaded.progress.levelStates).toEqual({ scouting: { round: 1 } });
    expect(loaded.progress.completedAt).toEqual({ tactics: '2026-10-18T11:00:00.000Z' });
    expect(loaded.progress.lastSavedAt).toBe('2026-10-18T12:00:00.000Z');
    expect(loaded.progress.schemaVersion).toBe(2);
  });

  it('损坏的 JSON 回退到默认进度并给出警告，不抛异常', () => {
    const storage = createMemoryStorage({ [PROGRESS_STORAGE_KEY]: '{ this is not json' });
    expect(() => loadProgress(storage)).not.toThrow();

    const loaded = loadProgress(storage);
    expect(loaded.progress).toEqual(getDefaultProgress());
    expect(loaded.warning).toBeTruthy();
  });

  it('schemaVersion 不兼容时回退到默认进度并给出警告', () => {
    const storage = createMemoryStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify({ ...getDefaultProgress(), schemaVersion: 1 }),
    });
    const loaded = loadProgress(storage);
    expect(loaded.progress).toEqual(getDefaultProgress());
    expect(loaded.warning).toBeTruthy();
  });

  it('storage 为 null 时回退到默认进度并给出警告', () => {
    const loaded = loadProgress(null);
    expect(loaded.progress).toEqual(getDefaultProgress());
    expect(loaded.warning).toBeTruthy();

    expect(saveProgress(getDefaultProgress(), null)).toEqual({
      ok: false,
      error: '本地存储不可用，进度未能保存。',
    });
  });
});

describe('设置保存与读取', () => {
  it('设置可以保存并读回', () => {
    const storage = createMemoryStorage();
    saveSettings({ reduceMotion: true }, storage);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(JSON.stringify({ reduceMotion: true }));
    expect(loadSettings(storage)).toEqual({ settings: { reduceMotion: true }, warning: null });
  });

  it('设置损坏或字段非法时回退到默认设置', () => {
    expect(loadSettings(createMemoryStorage({ [SETTINGS_STORAGE_KEY]: 'not-json' })).settings).toEqual(
      getDefaultSettings(),
    );
    expect(loadSettings(createMemoryStorage({ [SETTINGS_STORAGE_KEY]: '[]' })).settings).toEqual(getDefaultSettings());
    expect(
      loadSettings(createMemoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ reduceMotion: 'yes' }) })).settings,
    ).toEqual(getDefaultSettings());
    expect(loadSettings(null)).toEqual({ settings: getDefaultSettings(), warning: null });
    expect(() => saveSettings({ reduceMotion: true }, null)).not.toThrow();
  });
});

describe('清理存档', () => {
  it('clearStoredData 同时清空进度与设置两个 key，不影响其它数据', () => {
    const storage = createMemoryStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify(getDefaultProgress()),
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ reduceMotion: true }),
      'unrelated.key': 'keep-me',
    });

    clearStoredData(storage);

    expect(storage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('unrelated.key')).toBe('keep-me');
  });

  it('clearStoredData 在 storage 为 null 时不抛异常', () => {
    expect(() => clearStoredData(null)).not.toThrow();
  });
});

describe('sanitizeProgress 数据规整', () => {
  it('只保留合法的新 LevelId、去重并过滤非法 id', () => {
    const raw: unknown = {
      schemaVersion: 2,
      completedLevels: ['tactics', 'mine', 'tactics', 42, 'squad', 'workshop', null],
      unlockedMechanisms: ['tactics-shapes', 'push-your-luck', 'tactics-shapes', 'squad-registration'],
      currentLevel: 'mine',
      lastSavedAt: '2026-10-18T12:00:00.000Z',
      levelStates: { tactics: { step: 3 }, mine: { step: 1 }, unknown: { step: 2 } },
      completedAt: { tactics: '2026-10-18T11:00:00.000Z', mine: '2026-10-18T10:00:00.000Z', squad: 123 },
    };

    const progress = sanitizeProgress(raw);
    expect(progress).not.toBeNull();
    // 保留合法关卡，去掉旧题材 id 与重复项，并按关卡顺序排序。
    expect(progress?.completedLevels).toEqual(['tactics', 'squad']);
    expect(progress?.unlockedMechanisms).toEqual(['tactics-shapes', 'squad-registration']);
    expect(progress?.currentLevel).toBeNull();
    expect(progress?.levelStates).toEqual({ tactics: { step: 3 } });
    expect(progress?.completedAt).toEqual({ tactics: '2026-10-18T11:00:00.000Z' });
  });

  it('无法识别或版本不符的数据返回 null', () => {
    expect(sanitizeProgress(null)).toBeNull();
    expect(sanitizeProgress('text')).toBeNull();
    expect(sanitizeProgress([])).toBeNull();
    expect(sanitizeProgress({})).toBeNull();
    expect(sanitizeProgress({ schemaVersion: 1, completedLevels: [] })).toBeNull();
  });

  it('缺少字段时补成安全的空值', () => {
    const progress = sanitizeProgress({ schemaVersion: 2 });
    expect(progress).toEqual({
      schemaVersion: 2,
      completedLevels: [],
      unlockedMechanisms: [],
      currentLevel: null,
      lastSavedAt: new Date(0).toISOString(),
      levelStates: {},
      completedAt: {},
      club: {
        name: '北港联',
        season: '2026/27',
        week: 0,
        transferBudget: 45,
        wageBudget: 350,
        failures: 0,
        tactics: null,
        scoutedCandidates: [],
        signings: [],
        timeline: [],
        seasonReport: null,
      },
    });
  });
});
