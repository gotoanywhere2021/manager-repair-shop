import { LEVEL_ORDER, isLevelId, isMechanismId } from '../game/levels';
import type {
  ClubScoutCandidate,
  ClubSeasonReport,
  ClubSigning,
  ClubState,
  ClubTactics,
  ClubTimelineEntry,
  LevelId,
  MechanismId,
} from '../game/engine/types';

/** localStorage 读写与坏档回退。所有结构都显式校验，损坏数据不会让应用崩溃。 */

export const PROGRESS_STORAGE_KEY = 'manager-repair-shop.progress.v2';
export const SETTINGS_STORAGE_KEY = 'manager-repair-shop.settings.v1';
export const PROGRESS_SCHEMA_VERSION = 2;

export interface Progress {
  schemaVersion: number;
  completedLevels: LevelId[];
  unlockedMechanisms: MechanismId[];
  currentLevel: LevelId | null;
  lastSavedAt: string;
  /** 每关可恢复的组件状态，由关卡自行定义结构。 */
  levelStates: Partial<Record<LevelId, unknown>>;
  completedAt: Partial<Record<LevelId, string>>;
  /** 俱乐部档案：赛季、真实资源、跨关产出与维修时间线。 */
  club: ClubState;
}

export function getDefaultClub(): ClubState {
  return {
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
  };
}

export interface Settings {
  reduceMotion: boolean;
}

export interface LoadedProgress {
  progress: Progress;
  warning: string | null;
}

export interface LoadedSettings {
  settings: Settings;
  warning: string | null;
}

const LEVEL_IDS: LevelId[] = ['tactics', 'scouting', 'transfers', 'squad'];

export function getDefaultProgress(): Progress {
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    completedLevels: [],
    unlockedMechanisms: [],
    currentLevel: null,
    lastSavedAt: new Date(0).toISOString(),
    levelStates: {},
    completedAt: {},
    club: getDefaultClub(),
  };
}

export function getDefaultSettings(): Settings {
  return { reduceMotion: false };
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const probeKey = 'manager-repair-shop.probe';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function sanitizeLevelIds(value: unknown): LevelId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<LevelId>();
  const result: LevelId[] = [];
  for (const item of value) {
    if (isLevelId(item) && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function sanitizeMechanisms(value: unknown): MechanismId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<MechanismId>();
  const result: MechanismId[] = [];
  for (const item of value) {
    if (isMechanismId(item) && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function sanitizeLevelStates(value: unknown): Partial<Record<LevelId, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Partial<Record<LevelId, unknown>> = {};
  const record = value as Record<string, unknown>;
  for (const levelId of LEVEL_IDS) {
    if (record[levelId] !== undefined) result[levelId] = record[levelId];
  }
  return result;
}

function sanitizeCompletedAt(value: unknown): Partial<Record<LevelId, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Partial<Record<LevelId, string>> = {};
  const record = value as Record<string, unknown>;
  for (const levelId of LEVEL_IDS) {
    const raw = record[levelId];
    if (typeof raw === 'string') result[levelId] = raw;
  }
  return result;
}

function sanitizeClubTactics(value: unknown): ClubTactics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keys = ['possessionShape', 'outOfPossessionShape', 'fullbackDuty', 'pivotDuty'] as const;
  for (const key of keys) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) return null;
  }
  return {
    possessionShape: (raw.possessionShape as string).slice(0, 24),
    outOfPossessionShape: (raw.outOfPossessionShape as string).slice(0, 24),
    fullbackDuty: (raw.fullbackDuty as string).slice(0, 24),
    pivotDuty: (raw.pivotDuty as string).slice(0, 24),
  };
}

function sanitizeScoutedCandidates(value: unknown): ClubScoutCandidate[] {
  if (!Array.isArray(value)) return [];
  const result: ClubScoutCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    result.push({
      id: raw.id.slice(0, 40),
      name: raw.name.slice(0, 40),
      position: typeof raw.position === 'string' ? raw.position.slice(0, 20) : '未知',
      region: typeof raw.region === 'string' ? raw.region.slice(0, 30) : '未知',
      knowledge: typeof raw.knowledge === 'number' ? Math.min(100, Math.max(0, Math.round(raw.knowledge))) : 0,
    });
    if (result.length >= 8) break;
  }
  return result;
}

function sanitizeSignings(value: unknown): ClubSigning[] {
  if (!Array.isArray(value)) return [];
  const result: ClubSigning[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    result.push({
      id: raw.id.slice(0, 40),
      name: raw.name.slice(0, 40),
      position: typeof raw.position === 'string' ? raw.position.slice(0, 20) : '未知',
      fee: typeof raw.fee === 'number' && Number.isFinite(raw.fee) ? Math.max(0, raw.fee) : 0,
      wage: typeof raw.wage === 'number' && Number.isFinite(raw.wage) ? Math.max(0, raw.wage) : 0,
      homegrown: raw.homegrown === true,
    });
    if (result.length >= 8) break;
  }
  return result;
}

function sanitizeSeasonReport(value: unknown): ClubSeasonReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.headline !== 'string' || !raw.headline.trim()) return null;
  return {
    headline: raw.headline.slice(0, 160),
    details: Array.isArray(raw.details)
      ? raw.details.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).slice(0, 6)
      : [],
  };
}

function finiteOr(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

function sanitizeClub(value: unknown): ClubState {
  const fallback = getDefaultClub();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  const rawTimeline = Array.isArray(candidate.timeline) ? candidate.timeline : [];
  const timeline: ClubTimelineEntry[] = [];
  for (const item of rawTimeline) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (!isLevelId(entry.levelId) || typeof entry.headline !== 'string' || !entry.headline.trim()) continue;
    const details = Array.isArray(entry.details)
      ? entry.details.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).slice(0, 4)
      : [];
    timeline.push({
      levelId: entry.levelId,
      headline: entry.headline.slice(0, 120),
      details,
      at: typeof entry.at === 'string' ? entry.at : new Date(0).toISOString(),
    });
  }
  return {
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.slice(0, 24) : fallback.name,
    season: typeof candidate.season === 'string' && candidate.season.trim() ? candidate.season.slice(0, 16) : fallback.season,
    week: finiteOr(candidate.week, 0, 0, 99),
    transferBudget: finiteOr(candidate.transferBudget, fallback.transferBudget, 0, 500),
    wageBudget: finiteOr(candidate.wageBudget, fallback.wageBudget, 0, 2000),
    failures: finiteOr(candidate.failures, 0, 0, 99),
    tactics: sanitizeClubTactics(candidate.tactics),
    scoutedCandidates: sanitizeScoutedCandidates(candidate.scoutedCandidates),
    signings: sanitizeSignings(candidate.signings),
    timeline: timeline.slice(-8),
    seasonReport: sanitizeSeasonReport(candidate.seasonReport),
  };
}

/** 把外部数据规整为合法 Progress；无法识别的结构返回 null。 */
export function sanitizeProgress(raw: unknown): Progress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== PROGRESS_SCHEMA_VERSION) return null;
  const completedLevels = sanitizeLevelIds(candidate.completedLevels);
  const unlockedMechanisms = sanitizeMechanisms(candidate.unlockedMechanisms);
  const currentLevel = isLevelId(candidate.currentLevel) ? candidate.currentLevel : null;
  // 未完成关卡不能出现在已完成列表中；图鉴只解锁已完成关卡的机制。
  const levelOrderIndex = new Map(LEVEL_ORDER.map((id, index) => [id, index]));
  completedLevels.sort((a, b) => (levelOrderIndex.get(a) ?? 0) - (levelOrderIndex.get(b) ?? 0));
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    completedLevels,
    unlockedMechanisms,
    currentLevel,
    lastSavedAt: typeof candidate.lastSavedAt === 'string' ? candidate.lastSavedAt : new Date(0).toISOString(),
    levelStates: sanitizeLevelStates(candidate.levelStates),
    completedAt: sanitizeCompletedAt(candidate.completedAt),
    club: sanitizeClub(candidate.club),
  };
}

export function loadProgress(storage: Storage | null = getStorage()): LoadedProgress {
  if (!storage) {
    return { progress: getDefaultProgress(), warning: '浏览器没有提供本地存储，本次进度只能保留在当前页面。' };
  }
  let raw: string | null = null;
  try {
    raw = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return { progress: getDefaultProgress(), warning: '读取本地存档失败，已从新进度开始。' };
  }
  if (!raw) return { progress: getDefaultProgress(), warning: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    const progress = sanitizeProgress(parsed);
    if (!progress) {
      return {
        progress: getDefaultProgress(),
        warning: '本地存档版本不兼容或格式损坏，已安全回退到新进度。旧文件没有被覆盖。',
      };
    }
    return { progress, warning: null };
  } catch {
    return {
      progress: getDefaultProgress(),
      warning: '本地存档无法解析，已安全回退到新进度。旧文件没有被覆盖。',
    };
  }
}

export function saveProgress(progress: Progress, storage: Storage | null = getStorage()): { ok: boolean; error?: string } {
  if (!storage) return { ok: false, error: '本地存储不可用，进度未能保存。' };
  try {
    const payload: Progress = { ...progress, schemaVersion: PROGRESS_SCHEMA_VERSION };
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch {
    return { ok: false, error: '写入本地存档失败，可能是存储空间已满。' };
  }
}

export function loadSettings(storage: Storage | null = getStorage()): LoadedSettings {
  if (!storage) return { settings: getDefaultSettings(), warning: null };
  let raw: string | null = null;
  try {
    raw = storage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return { settings: getDefaultSettings(), warning: null };
  }
  if (!raw) return { settings: getDefaultSettings(), warning: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { settings: getDefaultSettings(), warning: '设置数据损坏，已恢复默认设置。' };
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      settings: { reduceMotion: candidate.reduceMotion === true },
      warning: null,
    };
  } catch {
    return { settings: getDefaultSettings(), warning: '设置数据无法解析，已恢复默认设置。' };
  }
}

export function saveSettings(settings: Settings, storage: Storage | null = getStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 设置保存失败不应中断游戏。
  }
}

export function clearStoredData(storage: Storage | null = getStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(PROGRESS_STORAGE_KEY);
    storage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // 忽略：调用方会给出提示。
  }
}

/** 供测试或极端情况创建可控的存储替身。 */
export function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}
