/**
 * 关卡二《球探室》的纯规则代码（v2 可玩性升级版）。
 *
 * v2 变化：
 * - 模块池：派遣槽（有限球探 / 广撒网考察）与报告槽（知识度报告 / 只看集锦），
 *   正确模块 + 有诱惑力但错误/有副作用的模块。
 * - 验证前可自由安装/卸载；允许不装齐正确模块就开始派遣，知识度与报告会真实变差。
 * - 验证有明确目标；未达成时给出具体原因，可清空成绩回到维修台重新配置。
 * - 完成时产出真实俱乐部时间线数据（clubUpdate）。
 *
 * 所有随机只来自 engine/rng.ts 的固定种子。
 */
import { recordEvent } from '../../engine/events';
import type { RngState } from '../../engine/rng';
import { createRng, isRngState, nextInt, normalizeSeed, reviveRng } from '../../engine/rng';
import type {
  ClubUpdate,
  EventLogEntry,
  EventState,
  Evidence,
  GameMode,
  LevelPhase,
  ShowcaseOptions,
} from '../../engine/types';
import { PHASE_ORDER, createEvidence } from '../../engine/types';

/* ==========================================================================
   区域与候选球员（全部虚构）
   ========================================================================== */

export type RegionId = 'local' | 'southern-europe' | 'northern-europe' | 'south-america';
export type ReportPrecision = 'unknown' | 'unreliable' | 'wide' | 'narrow' | 'precise';

export interface Region {
  id: RegionId;
  name: string;
  description: string;
  /** 地图布局用的相对坐标（0~1），只影响展示。 */
  mapX: number;
  mapY: number;
}

export const REGIONS: Region[] = [
  { id: 'local', name: '本地球市', description: '距离最近，信息最容易核实；候选多，但竞争也最透明。', mapX: 0.28, mapY: 0.32 },
  { id: 'southern-europe', name: '南欧', description: '技术型球员密集；需要更长时间才能看清真实水平。', mapX: 0.68, mapY: 0.24 },
  { id: 'northern-europe', name: '北欧', description: '身体与纪律出色；比赛节奏与本地差异大。', mapX: 0.3, mapY: 0.76 },
  { id: 'south-america', name: '南美', description: '天赋上限高，但报告最难核实，适应风险也最大。', mapX: 0.76, mapY: 0.72 },
];

const REGION_IDS: RegionId[] = ['local', 'southern-europe', 'northern-europe', 'south-america'];

export interface CandidateAbility {
  pace: number;
  technique: number;
  awareness: number;
  potential: number;
}

export interface ScoutCandidate {
  id: string;
  name: string;
  position: string;
  region: RegionId;
  ability: CandidateAbility;
}

/** 5 名虚构候选，覆盖 4 个区域。真实能力只在“选完以后”的对比里揭晓。 */
export const SCOUT_CANDIDATES: ScoutCandidate[] = [
  {
    id: 'lin-tuo',
    name: '林拓',
    position: '中后卫',
    region: 'local',
    ability: { pace: 58, technique: 62, awareness: 71, potential: 74 },
  },
  {
    id: 'luka-payne',
    name: '卢卡·佩恩',
    position: '左边锋',
    region: 'local',
    ability: { pace: 78, technique: 70, awareness: 64, potential: 72 },
  },
  {
    id: 'kai-ferro',
    name: '凯·费罗',
    position: '后腰',
    region: 'southern-europe',
    ability: { pace: 62, technique: 76, awareness: 70, potential: 80 },
  },
  {
    id: 'otto-lind',
    name: '奥托·林德',
    position: '中锋',
    region: 'northern-europe',
    ability: { pace: 70, technique: 66, awareness: 61, potential: 77 },
  },
  {
    id: 'marco-vera',
    name: '马科·维拉',
    position: '前腰',
    region: 'south-america',
    ability: { pace: 73, technique: 81, awareness: 69, potential: 85 },
  },
];

export function regionName(region: RegionId): string {
  return REGIONS.find((item) => item.id === region)?.name ?? region;
}

export function findCandidate(candidateId: string): ScoutCandidate | null {
  return SCOUT_CANDIDATES.find((item) => item.id === candidateId) ?? null;
}

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === 'string' && (REGION_IDS as string[]).includes(value);
}

export function trueOverall(candidate: ScoutCandidate): number {
  const ability = candidate.ability;
  return Math.round((ability.pace + ability.technique + ability.awareness + ability.potential) / 4);
}

export function abilityLines(candidate: ScoutCandidate): string {
  const ability = candidate.ability;
  return `速度 ${ability.pace} · 技术 ${ability.technique} · 意识 ${ability.awareness} · 潜力 ${ability.potential} · 总评 ${trueOverall(candidate)}`;
}

/* ==========================================================================
   模块池：派遣槽与报告槽
   ========================================================================== */

export type DispatchSlotModuleId = 'limited-scouts' | 'wide-net';
export type ReportSlotModuleId = 'knowledge-reports' | 'highlights';
export type ScoutingModuleId = DispatchSlotModuleId | ReportSlotModuleId;
export type ScoutingSlot = 'dispatch' | 'report';

export interface ScoutingLoadout {
  dispatch: DispatchSlotModuleId | null;
  report: ReportSlotModuleId | null;
}

export interface ScoutingModuleDefinition {
  id: ScoutingModuleId;
  slot: ScoutingSlot;
  name: string;
  englishName: string;
  description: string;
  /** 诚实的副作用说明，直接显示在模块卡上。 */
  sideEffect: string;
  effect: string;
  correct: boolean;
}

export const SCOUTING_MODULES: ScoutingModuleDefinition[] = [
  {
    id: 'limited-scouts',
    slot: 'dispatch',
    name: '有限球探',
    englishName: 'Limited Scouts',
    description: '只有 2 名球探，可以派往不同区域；每个区域每轮只能安排一名球探；回合结束收回。',
    sideEffect: '区域越多，单个区域的知识增长越慢；后手区域可能错过窗口。',
    effect: '每轮 2 名球探，每次考察 +35 知识度。',
    correct: true,
  },
  {
    id: 'wide-net',
    slot: 'dispatch',
    name: '广撒网考察',
    englishName: 'Wide Net',
    description: '一轮派出 3 名球探，覆盖更多区域，看起来很划算。',
    sideEffect: '每个区域每次只 +20 知识度；摊子铺得越大，单个区域越看不清。',
    effect: '每轮 3 名球探，但每次考察只 +20 知识度。',
    correct: false,
  },
  {
    id: 'knowledge-reports',
    slot: 'report',
    name: '知识度报告',
    englishName: 'Knowledge Reports',
    description: '知识度从低到高逐级解锁属性区间：低知识度只给模糊评价，高知识度才接近真实能力。',
    sideEffect: '报告看起来「很难用」是正常的；它保护你免于被虚假的精确数字骗到。',
    effect: '报告区间随区域知识度收窄（模糊 ±18 / 较窄 ±9 / 接近真实 ±3）。',
    correct: true,
  },
  {
    id: 'highlights',
    slot: 'report',
    name: '只看集锦',
    englishName: 'Highlight Reels',
    description: '不派球探也能立刻拿到一份报告，剪辑里的每个动作都很漂亮。',
    sideEffect: '报告永远只有 ±25 的不可靠区间；后续考察获得的知识度减半。',
    effect: '立即显示全部候选的 ±25 报告，但报告不随知识度变准，考察收益减半。',
    correct: false,
  },
];

export const KNOWLEDGE_GAIN = 35;
export const WIDE_NET_GAIN = 20;
export const WIDE_NET_SCOUTS = 3;
export const FALLBACK_SCOUTS = 1;
export const KNOWLEDGE_MAX = 100;
export const SCOUTS_PER_ROUND = 2;
export const ROUNDS_NORMAL = 2;
export const ROUNDS_FAST = 1;

export const HIGHLIGHTS_HALF_WIDTH = 25;
export const NO_REPORT_HALF_WIDTH = 18;

/** 阈值：<35 只给很宽的模糊评价；35–74 较窄；≥75 接近真实（±3）。 */
export const PRECISION_WIDE_MAX = 34;
export const PRECISION_NARROW_MAX = 74;
export const PRECISION_PRECISE_MIN = 75;

export function findScoutingModule(id: ScoutingModuleId): ScoutingModuleDefinition {
  const module = SCOUTING_MODULES.find((item) => item.id === id);
  if (!module) throw new Error(`未知球探模块：${id}`);
  return module;
}

export function loadoutModuleNames(loadout: ScoutingLoadout): string[] {
  const names: string[] = [];
  if (loadout.dispatch) names.push(findScoutingModule(loadout.dispatch).name);
  if (loadout.report) names.push(findScoutingModule(loadout.report).name);
  return names;
}

export function moduleScoutsPerRound(state: Pick<ScoutingState, 'loadout'>): number {
  if (state.loadout.dispatch === 'limited-scouts') return SCOUTS_PER_ROUND;
  if (state.loadout.dispatch === 'wide-net') return WIDE_NET_SCOUTS;
  return FALLBACK_SCOUTS;
}

/** 当前模块组合下，每次考察实际获得的知识度。 */
export function moduleKnowledgeGain(state: Pick<ScoutingState, 'loadout'>): number {
  let gain = 0;
  if (state.loadout.dispatch === 'limited-scouts') gain = KNOWLEDGE_GAIN;
  else if (state.loadout.dispatch === 'wide-net') gain = WIDE_NET_GAIN;
  if (state.loadout.report === 'highlights') gain = Math.floor(gain / 2);
  return gain;
}

/* ==========================================================================
   知识度与报告精度
   ========================================================================== */

export function reportPrecision(knowledge: number): ReportPrecision {
  if (knowledge <= 0) return 'unknown';
  if (knowledge <= PRECISION_WIDE_MAX) return 'wide';
  if (knowledge <= PRECISION_NARROW_MAX) return 'narrow';
  if (knowledge >= PRECISION_PRECISE_MIN) return 'precise';
  return 'narrow';
}

export function precisionLabel(precision: ReportPrecision): string {
  if (precision === 'unknown') return '未知';
  if (precision === 'unreliable') return '不可靠';
  if (precision === 'wide') return '模糊';
  if (precision === 'narrow') return '较窄';
  return '接近真实';
}

export function precisionDescription(precision: ReportPrecision): string {
  if (precision === 'unknown') return '未考察过，只确认名字与位置。';
  if (precision === 'unreliable') return '集锦报告：±25 区间，不会随考察变准。';
  if (precision === 'wide') return '知识度不足 35：范围很宽的模糊评价。';
  if (precision === 'narrow') return '知识度 35–74：区间缩小，但仍不能当精确值用。';
  return '知识度 75 以上：接近真实值（±3），仍不是精确值。';
}

/** 报告质量排序，验证目标用它判断「至少较窄」。 */
export function precisionRank(precision: ReportPrecision): number {
  if (precision === 'unknown') return 0;
  if (precision === 'unreliable') return 1;
  if (precision === 'wide') return 2;
  if (precision === 'narrow') return 3;
  return 4;
}

export function gainKnowledge(knowledge: number, gain: number = KNOWLEDGE_GAIN): number {
  return Math.min(KNOWLEDGE_MAX, Math.max(0, Math.round(knowledge + gain)));
}

const HALF_WIDTH: Record<Exclude<ReportPrecision, 'unknown' | 'unreliable'>, number> = { wide: 18, narrow: 9, precise: 3 };

export interface AbilityRange {
  low: number;
  high: number;
}

/** 纯知识度规则的报告区间：任何精度下都不会显示唯一精确值。 */
export function reportRange(overall: number, knowledge: number): AbilityRange | null {
  const precision = reportPrecision(knowledge);
  if (precision === 'unknown' || precision === 'unreliable') return null;
  const half = HALF_WIDTH[precision];
  return {
    low: Math.max(1, overall - half),
    high: Math.min(99, overall + half),
  };
}

function rangeAround(overall: number, half: number): AbilityRange {
  return {
    low: Math.max(1, overall - half),
    high: Math.min(99, overall + half),
  };
}

export interface CandidateReport {
  candidateId: string;
  precision: ReportPrecision;
  knowledge: number;
  range: AbilityRange | null;
  summary: string;
}

/** 纯知识度规则（默认假设装了知识度报告）。保留给规则测试与报告说明。 */
export function candidateReport(candidate: ScoutCandidate, knowledge: number): CandidateReport {
  const precision = reportPrecision(knowledge);
  if (precision === 'unknown') {
    return {
      candidateId: candidate.id,
      precision,
      knowledge,
      range: null,
      summary: '未知：还没有球探考察过这个区域。',
    };
  }
  const range = reportRange(trueOverall(candidate), knowledge);
  const summary = range
    ? `${precisionLabel(precision)}区间：综合能力 ${range.low}–${range.high}（知识度 ${knowledge}）`
    : '未知';
  return { candidateId: candidate.id, precision, knowledge, range, summary };
}

/** 当前模块组合下真正显示的报告：错误模块会真实影响精度。 */
export function candidateReportWithModules(
  candidate: ScoutCandidate,
  knowledge: number,
  loadout: ScoutingLoadout,
): CandidateReport {
  const overall = trueOverall(candidate);
  if (loadout.report === 'highlights') {
    const range = rangeAround(overall, HIGHLIGHTS_HALF_WIDTH);
    return {
      candidateId: candidate.id,
      precision: 'unreliable',
      knowledge,
      range,
      summary: `集锦报告（±25，不可靠）：综合能力 ${range.low}–${range.high}；后续考察收益减半。`,
    };
  }
  if (loadout.report === 'knowledge-reports') {
    return candidateReport(candidate, knowledge);
  }
  if (knowledge <= 0) {
    return {
      candidateId: candidate.id,
      precision: 'unknown',
      knowledge,
      range: null,
      summary: '未知：区域还没有被考察，也没有安装知识度报告。',
    };
  }
  const range = rangeAround(overall, NO_REPORT_HALF_WIDTH);
  return {
    candidateId: candidate.id,
    precision: 'wide',
    knowledge,
    range,
    summary: `未安装知识度报告：区间不会随考察收窄（知识度 ${knowledge}，按 ±18 估算）。`,
  };
}

/* ==========================================================================
   状态
   ========================================================================== */

export interface ScoutingRoundRecord {
  round: number;
  regions: RegionId[];
  knowledgeBefore: Record<RegionId, number>;
  knowledgeAfter: Record<RegionId, number>;
  knowledgeGain: number;
}

export interface ScoutingState {
  version: 2;
  phase: LevelPhase;
  mode: GameMode;
  fastPlay: boolean;
  seed: number;
  rng: RngState;
  candidateOrder: string[];
  knowledge: Record<RegionId, number>;
  /** 已经结束的轮数。 */
  round: number;
  /** 本关总轮数（正常 2 轮，演示快局 1 轮）。 */
  rounds: number;
  dispatches: RegionId[];
  history: ScoutingRoundRecord[];
  loadout: ScoutingLoadout;
  /** 第几次验证（0 表示还没重试过）。 */
  attempts: number;
  fault: { inspected: string[]; picked: string | null; done: boolean };
  diagnose: { resolved: boolean };
  selectedCandidateId: string | null;
  transfer: { resolved: boolean; skipped: boolean };
  evidence: Evidence;
  eventLog: EventLogEntry[];
  completed: boolean;
}

export interface ScoutingInitOptions {
  mode: GameMode;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
}

function initialKnowledge(): Record<RegionId, number> {
  return { local: 0, 'southern-europe': 0, 'northern-europe': 0, 'south-america': 0 };
}

export function scoutsAvailable(state: ScoutingState): number {
  if (state.phase !== 'verify' || state.round >= state.rounds) return 0;
  return Math.max(0, moduleScoutsPerRound(state) - state.dispatches.length);
}

export function isSelectingCandidate(state: ScoutingState): boolean {
  return state.phase === 'verify' && state.round >= state.rounds && state.selectedCandidateId === null;
}

/** 派遣轮次已经结束并且已经选出候选（进入迁移/归档后仍然成立）。 */
export function isVerificationDone(state: ScoutingState): boolean {
  return state.round >= state.rounds && state.selectedCandidateId !== null;
}

export function coveredRegions(state: Pick<ScoutingState, 'knowledge'>): RegionId[] {
  return REGION_IDS.filter((region) => state.knowledge[region] > 0);
}

/* ==========================================================================
   验证目标
   ========================================================================== */

export const SCOUTING_TARGETS = {
  coverageMin: 2,
  knowledgeThreshold: 35,
  /** 选中候选的报告至少达到这一档。 */
  reportPrecisionMin: 'narrow' as const,
};

export type ScoutingTargetId = 'modules' | 'coverage' | 'report';

export interface ScoutingTargetCheck {
  id: ScoutingTargetId;
  label: string;
  requirement: string;
  actual: string;
  met: boolean;
}

export interface ScoutingVerification {
  done: boolean;
  passed: boolean;
  targets: ScoutingTargetCheck[];
  failed: ScoutingTargetCheck[];
  covered: RegionId[];
}

export function evaluateScoutingVerification(state: ScoutingState): ScoutingVerification {
  const done = isVerificationDone(state);
  const covered = REGION_IDS.filter((region) => state.knowledge[region] >= SCOUTING_TARGETS.knowledgeThreshold);
  const selected = state.selectedCandidateId ? findCandidate(state.selectedCandidateId) : null;
  const selectedReport = selected
    ? candidateReportWithModules(selected, state.knowledge[selected.region], state.loadout)
    : null;
  const modulesCorrect = state.loadout.dispatch === 'limited-scouts' && state.loadout.report === 'knowledge-reports';
  const installedNames = loadoutModuleNames(state.loadout);
  const reportMet =
    selected !== null &&
    selectedReport !== null &&
    precisionRank(selectedReport.precision) >= precisionRank(SCOUTING_TARGETS.reportPrecisionMin);

  const targets: ScoutingTargetCheck[] = [
    {
      id: 'modules',
      label: '维修模块正确',
      requirement: '安装有限球探 + 知识度报告，且没有错误模块',
      actual: installedNames.length > 0 ? `已安装：${installedNames.join('、')}` : '没有安装任何模块',
      met: modulesCorrect,
    },
    {
      id: 'coverage',
      label: '区域覆盖',
      requirement: `至少 ${SCOUTING_TARGETS.coverageMin} 个区域知识度 ≥ ${SCOUTING_TARGETS.knowledgeThreshold}`,
      actual:
        covered.length > 0
          ? `${covered.length} 个区域达标：${covered.map((region) => `${regionName(region)} ${state.knowledge[region]}`).join('、')}`
          : '没有区域达标',
      met: covered.length >= SCOUTING_TARGETS.coverageMin,
    },
    {
      id: 'report',
      label: '候选报告可信',
      requirement: '选中候选的报告精度至少「较窄」',
      actual: selected
        ? `${selected.name}：${selectedReport ? precisionLabel(selectedReport.precision) : '未知'}（${regionName(selected.region)}知识度 ${state.knowledge[selected.region]}）`
        : '还没有选择候选',
      met: reportMet,
    },
  ];
  const failed = targets.filter((target) => !target.met);
  return { done, passed: done && failed.length === 0, targets, failed, covered };
}

/* ==========================================================================
   状态机
   ========================================================================== */

function isPhase(value: unknown): value is LevelPhase {
  return typeof value === 'string' && (PHASE_ORDER as string[]).includes(value);
}

function withEvent(
  state: ScoutingState,
  phase: LevelPhase,
  input: { action: string; label: string; before: EventState; after: EventState; delta?: string; note?: string },
): ScoutingState {
  return {
    ...state,
    eventLog: recordEvent(state.eventLog, { phase, ...input }),
  };
}

export function startFaultPlay(state: ScoutingState): ScoutingState {
  if (state.phase !== 'commission') return state;
  const next: ScoutingState = { ...state, phase: 'faultPlay' };
  return withEvent(next, 'faultPlay', {
    action: 'start-fault-play',
    label: '开始故障试玩：信息免费且瞬间完整',
    before: { phase: 'commission' },
    after: { phase: 'faultPlay' },
    note: '故障版里，点一次「考察」就能看到全部精确属性，考察没有成本。',
  });
}

export function inspectCandidate(state: ScoutingState, candidateId: string): ScoutingState {
  if (state.phase !== 'faultPlay' || state.fault.done) return state;
  const candidate = findCandidate(candidateId);
  if (!candidate || state.fault.inspected.includes(candidateId)) return state;
  const next: ScoutingState = {
    ...state,
    fault: { ...state.fault, inspected: [...state.fault.inspected, candidateId] },
  };
  return withEvent(next, 'faultPlay', {
    action: 'inspect-candidate',
    label: `瞬间考察：${candidate.name}`,
    before: { inspected: state.fault.inspected.length },
    after: { inspected: next.fault.inspected.length, candidate: candidate.name },
    note: `没有成本、没有等待，直接显示精确属性：${abilityLines(candidate)}。`,
  });
}

export function pickFaultCandidate(state: ScoutingState, candidateId: string): ScoutingState {
  if (state.phase !== 'faultPlay' || state.fault.done || state.fault.picked) return state;
  const candidate = findCandidate(candidateId);
  if (!candidate) return state;
  // 故障版的信息是点一次就全给：没有考察就不存在「挑人」这个动作。
  if (!state.fault.inspected.includes(candidateId)) return state;
  const next: ScoutingState = { ...state, fault: { ...state.fault, picked: candidateId } };
  return withEvent(next, 'faultPlay', {
    action: 'pick-fault-candidate',
    label: `加入候选名单：${candidate.name}`,
    before: { picked: 'none' },
    after: { picked: candidate.name },
    note: '在故障版里，这一步没有任何信息成本，所以也不构成判断。',
  });
}

export function finishFaultPlay(state: ScoutingState): ScoutingState {
  if (state.phase !== 'faultPlay' || state.fault.done || !state.fault.picked) return state;
  const next: ScoutingState = {
    ...state,
    phase: 'diagnose',
    fault: { ...state.fault, done: true },
    evidence: { ...state.evidence, experiencedFault: true },
  };
  return withEvent(next, 'diagnose', {
    action: 'finish-fault-play',
    label: '结束故障试玩：考察变成了点按钮',
    before: { phase: 'faultPlay', inspected: state.fault.inspected.length },
    after: { phase: 'diagnose', inspected: state.fault.inspected.length },
    note: '信息免费且瞬间完整，考察失去意义；诊断一下到底缺了什么。',
  });
}

export function resolveDiagnose(state: ScoutingState): ScoutingState {
  if (state.phase !== 'diagnose' || state.diagnose.resolved) return state;
  const next: ScoutingState = { ...state, diagnose: { resolved: true } };
  return withEvent(next, 'diagnose', {
    action: 'diagnose-correct',
    label: '诊断正确：球探数量有限，信息应该逐步变清楚',
    before: { resolved: 'false' },
    after: { resolved: 'true' },
    note: '下一步去维修台：4 个模块自由安装/卸载，再决定要不要直接开始派遣。',
  });
}

export function startRepair(state: ScoutingState): ScoutingState {
  if (state.phase !== 'diagnose' || !state.diagnose.resolved) return state;
  const next: ScoutingState = {
    ...state,
    phase: 'repair',
    round: 0,
    knowledge: initialKnowledge(),
    dispatches: [],
    history: [],
    selectedCandidateId: null,
  };
  return withEvent(next, 'repair', {
    action: 'start-repair',
    label: '开始维修：模块池自由配置',
    before: { phase: 'diagnose' },
    after: { phase: 'repair' },
    note: '有限球探负责派人，知识度报告负责把信息变清楚；错误模块也能装，但要承担真实副作用。',
  });
}

/* ---------- 维修台的模块操作（仅 repair 阶段） ---------- */

export function installScoutingModule(state: ScoutingState, id: ScoutingModuleId): ScoutingState {
  if (state.phase !== 'repair') return state;
  if (!SCOUTING_MODULES.some((item) => item.id === id)) return state;
  const module = findScoutingModule(id);
  if (state.loadout[module.slot] === id) return state;
  const previous = state.loadout[module.slot];
  const next: ScoutingState = { ...state, loadout: { ...state.loadout, [module.slot]: id } as ScoutingLoadout };
  return withEvent(next, 'repair', {
    action: `install-module-${id}`,
    label: `安装模块：${module.name}`,
    before: { slot: module.slot, installed: previous ?? '空' },
    after: { slot: module.slot, installed: module.name, effect: module.effect },
    delta: module.correct ? '正确模块' : '错误模块（有副作用）',
    note: module.sideEffect,
  });
}

export function uninstallScoutingModule(state: ScoutingState, id: ScoutingModuleId): ScoutingState {
  if (state.phase !== 'repair') return state;
  const module = findScoutingModule(id);
  if (state.loadout[module.slot] !== id) return state;
  const next: ScoutingState = { ...state, loadout: { ...state.loadout, [module.slot]: null } as ScoutingLoadout };
  return withEvent(next, 'repair', {
    action: `uninstall-module-${id}`,
    label: `卸载模块：${module.name}`,
    before: { slot: module.slot, installed: module.name },
    after: { slot: module.slot, installed: '空' },
  });
}

export function toggleScoutingModule(state: ScoutingState, id: ScoutingModuleId): ScoutingState {
  if (state.phase !== 'repair') return state;
  const module = findScoutingModule(id);
  return state.loadout[module.slot] === id ? uninstallScoutingModule(state, id) : installScoutingModule(state, id);
}

/** 兼容旧测试/调用：安装正确的有限球探。 */
export function installLimitedScouts(state: ScoutingState): ScoutingState {
  return installScoutingModule(state, 'limited-scouts');
}

/** 兼容旧测试/调用：安装正确的知识度报告。 */
export function installKnowledgeReports(state: ScoutingState): ScoutingState {
  return installScoutingModule(state, 'knowledge-reports');
}

export function startVerify(state: ScoutingState): ScoutingState {
  if (state.phase !== 'repair') return state;
  const next: ScoutingState = {
    ...state,
    phase: 'verify',
    round: 0,
    knowledge: initialKnowledge(),
    dispatches: [],
    history: [],
    selectedCandidateId: null,
  };
  return withEvent(next, 'verify', {
    action: 'start-verify',
    label: `开始派遣：${state.rounds} 轮，每轮 ${moduleScoutsPerRound(state)} 名球探（第 ${state.attempts + 1} 次尝试）`,
    before: { phase: 'repair', modules: loadoutModuleNames(state.loadout).join('、') || '无' },
    after: { phase: 'verify', rounds: state.rounds, scouts: moduleScoutsPerRound(state) },
    note: '轮末球探收回，知识度留在区域里；目标会在选完候选后逐条判定。',
  });
}

export function canAssignScout(state: ScoutingState, region: unknown): region is RegionId {
  if (state.phase !== 'verify' || state.round >= state.rounds) return false;
  if (!isRegionId(region)) return false;
  if (state.dispatches.includes(region)) return false;
  return state.dispatches.length < moduleScoutsPerRound(state);
}

export function assignScout(state: ScoutingState, region: RegionId): ScoutingState {
  if (!canAssignScout(state, region)) return state;
  const perRound = moduleScoutsPerRound(state);
  const next: ScoutingState = { ...state, dispatches: [...state.dispatches, region] };
  return withEvent(next, 'verify', {
    action: 'assign-scout',
    label: `派遣球探：${regionName(region)}`,
    before: { scoutsAvailable: perRound - state.dispatches.length, round: state.round + 1 },
    after: { scoutsAvailable: perRound - next.dispatches.length, round: state.round + 1 },
    delta: `剩余球探 ${perRound - next.dispatches.length} 名`,
    note: '球探派出后不算完成，轮末才收回；同一轮不能再来这个区域。',
  });
}

export function endRound(state: ScoutingState): ScoutingState {
  if (state.phase !== 'verify' || state.round >= state.rounds) return state;
  if (state.dispatches.length !== moduleScoutsPerRound(state)) return state;
  const gain = moduleKnowledgeGain(state);
  const before = { ...state.knowledge };
  const after = { ...state.knowledge };
  for (const region of state.dispatches) {
    after[region] = gainKnowledge(after[region], gain);
  }
  const record: ScoutingRoundRecord = {
    round: state.round + 1,
    regions: [...state.dispatches],
    knowledgeBefore: before,
    knowledgeAfter: after,
    knowledgeGain: gain,
  };
  const next: ScoutingState = {
    ...state,
    round: state.round + 1,
    dispatches: [],
    knowledge: after,
    history: [...state.history, record],
  };
  return withEvent(next, 'verify', {
    action: 'end-round',
    label: `第 ${record.round} 轮结束：球探收回`,
    before: { round: state.round, ...before },
    after: { round: next.round, ...after },
    delta:
      gain > 0
        ? state.dispatches.map((region) => `${regionName(region)} +${gain}`).join(' · ')
        : '没有球探网络：本轮没有获得知识度',
    note: '同一区域每轮最多被考察一次；知识度越高，报告区间越窄。',
  });
}

export function selectCandidate(state: ScoutingState, candidateId: string): ScoutingState {
  if (state.phase !== 'verify') return state;
  if (state.round < state.rounds) return state;
  if (state.selectedCandidateId !== null) return state;
  const candidate = findCandidate(candidateId);
  if (!candidate) return state;
  const report = candidateReportWithModules(candidate, state.knowledge[candidate.region], state.loadout);
  const next: ScoutingState = {
    ...state,
    selectedCandidateId: candidateId,
  };
  const verification = evaluateScoutingVerification(next);
  if (verification.passed) {
    next.evidence = { ...next.evidence, operatedMechanic: true };
  }
  return withEvent(next, 'verify', {
    action: 'select-candidate',
    label: `根据报告加入候选名单：${candidate.name}`,
    before: { selected: 'none' },
    after: { selected: candidate.name, report: report.summary },
    delta: report.precision === 'unknown' ? '未知区域' : `精度 ${precisionLabel(report.precision)}`,
    note: '这次选择只能依据当时可见的报告；真实能力在归档对比里才揭晓。',
  });
}

/** 验证未达成后回到维修台：清空本轮派遣与选择，保留故障证据与模块配置以便调整。 */
export function retryVerification(state: ScoutingState): ScoutingState {
  if (state.phase !== 'verify' || !isVerificationDone(state)) return state;
  const verification = evaluateScoutingVerification(state);
  if (verification.passed) return state;
  const next: ScoutingState = {
    ...state,
    phase: 'repair',
    round: 0,
    knowledge: initialKnowledge(),
    dispatches: [],
    history: [],
    selectedCandidateId: null,
    attempts: state.attempts + 1,
  };
  return withEvent(next, 'repair', {
    action: 'retry-verification',
    label: '验证未达成：回到维修台重新配置',
    before: { phase: 'verify', round: state.round, covered: verification.covered.length },
    after: { phase: 'repair', attempts: next.attempts },
    delta: `未达成 ${verification.failed.length} 项目标`,
    note: `未达成：${verification.failed
      .map((target) => `${target.label}（${target.actual}，要求 ${target.requirement}）`)
      .join('；')}。本轮派遣成绩与选择已清空。`,
  });
}

export function openTransfer(state: ScoutingState): ScoutingState {
  if (state.phase !== 'verify') return state;
  if (!evaluateScoutingVerification(state).passed) return state;
  const next: ScoutingState = { ...state, phase: 'transfer' };
  return withEvent(next, 'transfer', {
    action: 'open-transfer',
    label: '完成派遣，去迁移题',
    before: { phase: 'verify' },
    after: { phase: 'transfer' },
    note: '用同一套结构去判断另一个情境。',
  });
}

export function resolveTransfer(state: ScoutingState): ScoutingState {
  if (state.phase !== 'transfer' || state.transfer.resolved) return state;
  const next: ScoutingState = {
    ...state,
    transfer: { ...state.transfer, resolved: true },
    evidence: { ...state.evidence, transferred: true },
  };
  return withEvent(next, 'transfer', {
    action: 'transfer-correct',
    label: '迁移正确：有限球探 + 区域容量 + 轮末收回 + 信息逐步积累',
    before: { resolved: 'false' },
    after: { resolved: 'true' },
    note: '四个特征缺一不可；只满足其中一条就只是普通考察。',
  });
}

export function skipTransferInShowcase(state: ScoutingState): ScoutingState {
  if (state.mode !== 'showcase' || state.phase !== 'transfer' || state.transfer.resolved) return state;
  const next: ScoutingState = {
    ...state,
    phase: 'summary',
    transfer: { resolved: false, skipped: true },
  };
  return withEvent(next, 'summary', {
    action: 'demo-skip-transfer',
    label: '演示跳过迁移题',
    before: { phase: 'transfer', transferred: String(state.evidence.transferred) },
    after: { phase: 'summary', transferred: 'false' },
    note: '展示模式允许跳过；本次不计「迁移」证据，仍可完成演示。',
  });
}

export function openSummary(state: ScoutingState): ScoutingState {
  if (state.phase !== 'transfer' || !state.transfer.resolved) return state;
  const next: ScoutingState = { ...state, phase: 'summary' };
  return withEvent(next, 'summary', {
    action: 'open-summary',
    label: '进入归档',
    before: { phase: 'transfer' },
    after: { phase: 'summary' },
    note: '归档只展示真实派遣记录与真实报告。',
  });
}

export type CompleteBlocker = 'not-summary' | 'already-complete' | 'verify-unmet' | 'transfer-missing' | 'prereq-missing';

export function archiveBlocker(state: ScoutingState): CompleteBlocker | null {
  if (state.phase !== 'summary') return 'not-summary';
  if (state.completed) return 'already-complete';
  if (!evaluateScoutingVerification(state).passed) return 'verify-unmet';
  if (state.mode !== 'showcase' && (!state.fault.done || !state.diagnose.resolved)) return 'prereq-missing';
  if (state.mode !== 'showcase' && !state.transfer.resolved) return 'transfer-missing';
  return null;
}

export function canComplete(state: ScoutingState): boolean {
  return archiveBlocker(state) === null;
}

export function archiveBlockReason(state: ScoutingState): string {
  const blocker = archiveBlocker(state);
  if (blocker === 'already-complete') return '已经归档完成，不会重复结算。';
  if (blocker === 'verify-unmet') {
    const failed = evaluateScoutingVerification(state).failed;
    return `验证目标未达成：${failed
      .map((target) => `${target.label}（${target.actual}，要求 ${target.requirement}）`)
      .join('；')}。请回到维修台重新配置。`;
  }
  if (blocker === 'transfer-missing') return '迁移题还没有答对，完成迁移后才能归档。';
  if (blocker === 'prereq-missing') return '还没有完成故障试玩与诊断，不能直接归档。';
  return '还没有完成派遣与选择，暂时不能归档。';
}

export function completeArchive(state: ScoutingState): ScoutingState {
  if (!canComplete(state)) return state;
  const next: ScoutingState = { ...state, completed: true };
  return withEvent(next, 'summary', {
    action: 'archive',
    label: '完成归档：球探网络',
    before: { completed: 'false' },
    after: { completed: 'true', rounds: state.round, evidence: String(countEvidence(state.evidence)) },
    note: '完成记录只包含真实派遣与真实报告；不要求选中「最强」球员。',
  });
}

export function countEvidence(evidence: Evidence): number {
  return Number(evidence.experiencedFault) + Number(evidence.operatedMechanic) + Number(evidence.transferred);
}

/* ==========================================================================
   报告、对比与归档
   ========================================================================== */

export function buildCandidateReports(state: ScoutingState): CandidateReport[] {
  return state.candidateOrder
    .map((id) => findCandidate(id))
    .filter((candidate): candidate is ScoutCandidate => candidate !== null)
    .map((candidate) => candidateReportWithModules(candidate, state.knowledge[candidate.region], state.loadout));
}

export interface ScoutingComparisonRow {
  label: string;
  fault: string;
  fixed: string;
}

export function buildScoutingComparison(state: ScoutingState): ScoutingComparisonRow[] {
  const faultPicked = state.fault.picked ? findCandidate(state.fault.picked) : null;
  const selected = state.selectedCandidateId ? findCandidate(state.selectedCandidateId) : null;
  const selectedReport = selected
    ? candidateReportWithModules(selected, state.knowledge[selected.region], state.loadout)
    : null;
  const covered = coveredRegions(state);
  return [
    {
      label: '信息范围',
      fault: '5 名候选的全部精确属性，一点即见',
      fixed:
        covered.length > 0
          ? `${covered.map((region) => regionName(region)).join('、')} 有报告；其余区域仍是「未知」`
          : '没有区域有报告',
    },
    {
      label: '考察成本',
      fault: '0 次派遣、0 轮等待',
      fixed: `${state.round} 轮 × ${moduleScoutsPerRound(state)} 名球探 = ${state.round * moduleScoutsPerRound(state)} 次区域考察（每次 +${moduleKnowledgeGain(state)}）`,
    },
    {
      label: '选择依据',
      fault: faultPicked ? `${faultPicked.name}：总评 ${trueOverall(faultPicked)}（精确值）` : '还没有选择',
      fixed: selected && selectedReport ? `${selected.name}：${selectedReport.summary}` : '还没有选择',
    },
    {
      label: '真实能力（选完才揭晓）',
      fault: faultPicked ? `${faultPicked.name}：总评 ${trueOverall(faultPicked)}` : '还没有选择',
      fixed: selected ? `${selected.name}：总评 ${trueOverall(selected)}（${selected.position} · ${regionName(selected.region)}）` : '还没有选择',
    },
  ];
}

export function buildArchiveSummary(state: ScoutingState): string[] {
  const selected = state.selectedCandidateId ? findCandidate(state.selectedCandidateId) : null;
  const selectedReport = selected
    ? candidateReportWithModules(selected, state.knowledge[selected.region], state.loadout)
    : null;
  const covered = coveredRegions(state).map((region) => `${regionName(region)} ${state.knowledge[region]}`);
  const verified = evaluateScoutingVerification(state);
  return [
    '改了哪条规则：把「点一下就看到全部精确属性」改成「2 名球探、每轮最多考察 2 个区域、同一区域每轮 1 人、轮末收回」，并让区域知识度决定报告精度。',
    `改变了什么选择：先派球探去哪些区域、接受报告从模糊区间逐轮变窄，而不是等一个精确数字。最终选了 ${
      selected ? `${selected.name}（${selected.position}）` : '一名候选'
    }${selectedReport ? `，依据是${selectedReport.summary}` : ''}。`,
    `产生了什么代价：${state.rounds} 轮最多只能覆盖 ${state.round * moduleScoutsPerRound(state)} 个区域次（实际考察：${
      covered.join('、') || '没有区域'
    }），知识度不足的区域只能接受更宽区间；验证目标 ${verified.targets.filter((target) => target.met).length}/${verified.targets.length} 项达成。`,
  ];
}

/* ==========================================================================
   俱乐部时间线：只写真实数据
   ========================================================================== */

export function buildClubUpdate(state: ScoutingState): ClubUpdate {
  const selected = state.selectedCandidateId ? findCandidate(state.selectedCandidateId) : null;
  const selectedReport = selected
    ? candidateReportWithModules(selected, state.knowledge[selected.region], state.loadout)
    : null;
  const covered = coveredRegions(state);
  const coverageText = covered.map((region) => `${regionName(region)} ${state.knowledge[region]}`).join('、') || '没有区域';
  const rangeText = selectedReport?.range ? `${selectedReport.range.low}–${selectedReport.range.high}` : '未知';
  return {
    headline: `球探网络上线索：${covered.length} 个区域有报告，${
      selected ? `${selected.name} 以「${selectedReport ? precisionLabel(selectedReport.precision) : '未知'}」报告入选` : '候选名单待定'
    }`,
    details: [
      `派遣记录：${state.round} 轮 × ${moduleScoutsPerRound(state)} 名球探，实际考察 ${coverageText}；每次考察 +${moduleKnowledgeGain(state)} 知识度。`,
      `候选报告：${selected ? `${selected.name}（${selected.position}，${regionName(selected.region)}）区间 ${rangeText}，精度「${selectedReport ? precisionLabel(selectedReport.precision) : '未知'}」` : '还没有选择候选'}。`,
      `真实能力（选完才揭晓）：${selected ? `${selected.name} 总评 ${trueOverall(selected)}` : '未知'}；未考察区域保持「未知」。`,
      `验证目标全部达成：至少 ${SCOUTING_TARGETS.coverageMin} 个区域知识度 ≥ ${SCOUTING_TARGETS.knowledgeThreshold}、候选报告精度 ≥「${precisionLabel(SCOUTING_TARGETS.reportPrecisionMin)}」。`,
    ],
    nextBrief: '转会窗即将开启：体育总监顾航需要同时控制预算、工资空间与报价竞争。',
  };
}

export function buildCompletionResult(state: ScoutingState): { evidence: Evidence; summary: string[]; clubUpdate: ClubUpdate } {
  return {
    evidence: { ...state.evidence },
    summary: buildArchiveSummary(state),
    clubUpdate: buildClubUpdate(state),
  };
}

/* ==========================================================================
   诊断与迁移题目
   ========================================================================== */

export interface QuizOptionData {
  id: string;
  label: string;
  explanation: string;
}

export const DIAGNOSE_CORRECT_ID = 'scouts-limited';

export const DIAGNOSE_OPTIONS: QuizOptionData[] = [
  {
    id: DIAGNOSE_CORRECT_ID,
    label: '球探数量有限，信息应该逐步变清楚。',
    explanation: '球探是有限资源：派人、分区域、等轮次，报告才会一轮轮变清楚。信息不是免费的。',
  },
  {
    id: 'need-better-players',
    label: '候选球员质量不够，应该只挑总评最高的那个。',
    explanation: '问题不在候选质量，而在信息成本：全知状态下挑谁都一样，因为根本没有判断过程。',
  },
  {
    id: 'need-more-clicks',
    label: '考察按钮点得不够快，应该提高点击速度。',
    explanation: '点得更快只会让「没有成本」更明显；考察需要成本，才需要判断。',
  },
];

export const TRANSFER_CORRECT_ID = 'limited-scouts-network';

export const TRANSFER_OPTIONS: QuizOptionData[] = [
  {
    id: 'unlimited-inspect',
    label: '无限点击考察：想看谁就看谁，瞬间得到全部精确属性。',
    explanation: '这是故障版：信息免费且瞬间完整，没有分配与等待。',
  },
  {
    id: 'ask-price',
    label: '直接向对方俱乐部问价：报价数字就是真实能力。',
    explanation: '问价得到的是一个数字，没有区域容量、没有轮次，也没有逐步积累。',
  },
  {
    id: TRANSFER_CORRECT_ID,
    label: '派有限球探分区域考察：每轮人数有限、区域有容量、轮末收回，报告随知识度一轮轮变清楚。',
    explanation: '对。有限球探 + 区域容量 + 轮末收回 + 信息逐步积累，四个特征同时成立。',
  },
];

/* ==========================================================================
   初始化与坏档校验
   ========================================================================== */

function requestedPhase(options: ScoutingInitOptions): LevelPhase {
  if (options.mode === 'showcase' && options.showcaseOptions) {
    const phase = options.showcaseOptions.startPhase;
    if (phase === 'commission' || phase === 'faultPlay' || phase === 'diagnose' || phase === 'repair' || phase === 'verify') {
      return phase;
    }
    return 'verify';
  }
  return options.fastStart ? 'faultPlay' : 'commission';
}

/** 用固定种子打乱候选展示顺序；不改变任何真实能力或报告规则。 */
function shuffleCandidates(seed: number): { order: string[]; rng: RngState } {
  let rng = createRng(seed);
  const order = SCOUT_CANDIDATES.map((candidate) => candidate.id);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const draw = nextInt(rng, index + 1);
    rng = draw.rng;
    const swap = order[index];
    order[index] = order[draw.value];
    order[draw.value] = swap;
  }
  return { order, rng };
}

function createBaseState(options: ScoutingInitOptions, seed: number, phase: LevelPhase): ScoutingState {
  const fastPlay = options.mode === 'showcase' && options.showcaseOptions?.fastPlay === true;
  const normalizedSeed = normalizeSeed(seed);
  const shuffled = shuffleCandidates(normalizedSeed);
  return {
    version: 2,
    phase,
    mode: options.mode,
    fastPlay,
    seed: normalizedSeed,
    rng: shuffled.rng,
    candidateOrder: shuffled.order,
    knowledge: initialKnowledge(),
    round: 0,
    rounds: fastPlay ? ROUNDS_FAST : ROUNDS_NORMAL,
    dispatches: [],
    history: [],
    loadout: { dispatch: null, report: null },
    attempts: 0,
    fault: { inspected: [], picked: null, done: false },
    diagnose: { resolved: false },
    selectedCandidateId: null,
    transfer: { resolved: false, skipped: false },
    evidence: createEvidence(),
    eventLog: [],
    completed: false,
  };
}

/**
 * 展示模式按 startPhase 预填前置步骤：
 * repair = 诊断完成、模块未装；verify = 两个正确模块已装，可以直接开始派遣。
 * 预填不会把玩家没做过的步骤写成证据。
 */
export function createInitialScoutingState(options: ScoutingInitOptions, seed: number): ScoutingState {
  const phase = requestedPhase(options);
  const state = createBaseState(options, seed, phase);
  const faultPrefill = {
    inspected: SCOUT_CANDIDATES.map((candidate) => candidate.id),
    picked: SCOUT_CANDIDATES[0].id,
    done: true,
  };
  if (phase === 'commission' || phase === 'faultPlay') return state;
  if (phase === 'diagnose') {
    return { ...state, fault: faultPrefill };
  }
  if (phase === 'repair') {
    return { ...state, fault: faultPrefill, diagnose: { resolved: true } };
  }
  return {
    ...state,
    phase: 'verify',
    fault: faultPrefill,
    diagnose: { resolved: true },
    loadout: { dispatch: 'limited-scouts', report: 'knowledge-reports' },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isEventState(value: unknown): value is EventState {
  if (!isObject(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string' || isFiniteNumber(item));
}

function isValidEventLog(value: unknown): value is EventLogEntry[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!isObject(entry)) return false;
    return (
      isFiniteNumber(entry.seq) &&
      isPhase(entry.phase) &&
      typeof entry.action === 'string' &&
      typeof entry.label === 'string' &&
      isEventState(entry.before) &&
      isEventState(entry.after) &&
      (entry.delta === undefined || typeof entry.delta === 'string') &&
      (entry.note === undefined || typeof entry.note === 'string')
    );
  });
}

function isKnowledgeRecord(value: unknown): value is Record<RegionId, number> {
  if (!isObject(value)) return false;
  return REGION_IDS.every((region) => {
    const amount = value[region];
    return isFiniteNumber(amount) && amount >= 0 && amount <= KNOWLEDGE_MAX;
  });
}

function isRoundRecord(value: unknown): value is ScoutingRoundRecord {
  if (!isObject(value)) return false;
  if (!isFiniteNumber(value.round) || value.round < 1) return false;
  if (!Array.isArray(value.regions) || !value.regions.every(isRegionId)) return false;
  if (!isFiniteNumber(value.knowledgeGain) || value.knowledgeGain < 0) return false;
  return isKnowledgeRecord(value.knowledgeBefore) && isKnowledgeRecord(value.knowledgeAfter);
}

function isEvidenceShape(value: unknown): value is Evidence {
  if (!isObject(value)) return false;
  return isBoolean(value.experiencedFault) && isBoolean(value.operatedMechanic) && isBoolean(value.transferred);
}

function isValidCandidateOrder(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== SCOUT_CANDIDATES.length) return false;
  const set = new Set(value);
  if (set.size !== SCOUT_CANDIDATES.length) return false;
  return SCOUT_CANDIDATES.every((candidate) => set.has(candidate.id));
}

function isLoadout(value: unknown): value is ScoutingLoadout {
  if (!isObject(value)) return false;
  const dispatch = value.dispatch;
  const report = value.report;
  const dispatchOk = dispatch === null || dispatch === 'limited-scouts' || dispatch === 'wide-net';
  const reportOk = report === null || report === 'knowledge-reports' || report === 'highlights';
  return dispatchOk && reportOk;
}

function isSelectedId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && findCandidate(value) !== null);
}

/** 校验并恢复存档（只接受 v2 结构；旧版存档安全回退）。 */
export function reviveScoutingState(raw: unknown, options: ScoutingInitOptions): ScoutingState | null {
  if (!isObject(raw)) return null;
  if (raw.version !== 2) return null;
  if (!isPhase(raw.phase)) return null;
  const mode = raw.mode;
  if (mode !== 'normal' && mode !== 'showcase') return null;
  if (mode !== options.mode) return null;
  if (!isBoolean(raw.fastPlay)) return null;
  const expectedFastPlay = options.mode === 'showcase' && options.showcaseOptions?.fastPlay === true;
  if (raw.fastPlay !== expectedFastPlay) return null;
  if (!isFiniteNumber(raw.seed) || !isRngState(raw.rng)) return null;
  if (!isValidCandidateOrder(raw.candidateOrder)) return null;
  if (!isKnowledgeRecord(raw.knowledge)) return null;
  if (!isFiniteNumber(raw.round) || raw.round < 0 || raw.round > ROUNDS_NORMAL) return null;
  if (!isFiniteNumber(raw.rounds) || raw.rounds !== (raw.fastPlay ? ROUNDS_FAST : ROUNDS_NORMAL)) return null;
  if (raw.round > raw.rounds) return null;
  if (!Array.isArray(raw.dispatches) || !raw.dispatches.every(isRegionId)) return null;
  if (new Set(raw.dispatches).size !== raw.dispatches.length) return null;
  if (!isLoadout(raw.loadout)) return null;
  if (!isFiniteNumber(raw.attempts) || raw.attempts < 0) return null;
  const loadout = raw.loadout as ScoutingLoadout;
  const expectedScouts = loadout.dispatch === 'limited-scouts' ? SCOUTS_PER_ROUND : loadout.dispatch === 'wide-net' ? WIDE_NET_SCOUTS : FALLBACK_SCOUTS;
  if (raw.dispatches.length > expectedScouts) return null;
  if (!Array.isArray(raw.history) || !raw.history.every(isRoundRecord)) return null;
  if (raw.history.length !== raw.round) return null;
  const fault = raw.fault;
  if (!isObject(fault)) return null;
  if (!Array.isArray(fault.inspected) || !fault.inspected.every((id) => typeof id === 'string' && findCandidate(id) !== null)) return null;
  if (!isSelectedId(fault.picked)) return null;
  if (!isBoolean(fault.done)) return null;
  const diagnose = raw.diagnose;
  if (!isObject(diagnose) || !isBoolean(diagnose.resolved)) return null;
  if (!isSelectedId(raw.selectedCandidateId)) return null;
  const transfer = raw.transfer;
  if (!isObject(transfer) || !isBoolean(transfer.resolved) || !isBoolean(transfer.skipped)) return null;
  if (!isEvidenceShape(raw.evidence)) return null;
  if (!isValidEventLog(raw.eventLog)) return null;
  if (!isBoolean(raw.completed)) return null;

  // 交叉校验：阶段不能早于已完成的前置步骤，避免读档绕过验证。
  if (raw.selectedCandidateId !== null && raw.round < raw.rounds) return null;
  if ((raw.phase === 'transfer' || raw.phase === 'summary') && raw.selectedCandidateId === null) return null;
  if (raw.phase === 'summary' && raw.mode === 'normal' && !transfer.resolved) return null;
  if (raw.phase === 'repair' && (raw.round !== 0 || raw.selectedCandidateId !== null || raw.dispatches.length > 0)) return null;

  return {
    version: 2,
    phase: raw.phase,
    mode,
    fastPlay: raw.fastPlay,
    seed: normalizeSeed(raw.seed),
    rng: reviveRng(raw.rng),
    candidateOrder: [...(raw.candidateOrder as string[])],
    knowledge: { ...(raw.knowledge as Record<RegionId, number>) },
    round: raw.round,
    rounds: raw.rounds,
    dispatches: [...(raw.dispatches as RegionId[])],
    history: (raw.history as ScoutingRoundRecord[]).map((record) => ({
      round: record.round,
      regions: [...record.regions],
      knowledgeBefore: { ...record.knowledgeBefore },
      knowledgeAfter: { ...record.knowledgeAfter },
      knowledgeGain: record.knowledgeGain,
    })),
    loadout: { dispatch: loadout.dispatch, report: loadout.report },
    attempts: Math.floor(raw.attempts),
    fault: {
      inspected: [...(fault.inspected as string[])],
      picked: fault.picked as string | null,
      done: fault.done,
    },
    diagnose: { resolved: diagnose.resolved },
    selectedCandidateId: raw.selectedCandidateId as string | null,
    transfer: { resolved: transfer.resolved, skipped: transfer.skipped },
    evidence: {
      experiencedFault: (raw.evidence as Evidence).experiencedFault,
      operatedMechanic: (raw.evidence as Evidence).operatedMechanic,
      transferred: (raw.evidence as Evidence).transferred,
    },
    eventLog: [...(raw.eventLog as EventLogEntry[])],
    completed: raw.completed,
  };
}

/** 界面用：区域知识度的精度描述。 */
export function knowledgeSummary(state: Pick<ScoutingState, 'knowledge'>, region: RegionId): string {
  const knowledge = state.knowledge[region];
  const precision = reportPrecision(knowledge);
  return `${precisionLabel(precision)} · ${precisionDescription(precision)}`;
}

/** 界面用：当前派遣规则的一行摘要。 */
export function dispatchRuleSummary(state: Pick<ScoutingState, 'loadout' | 'rounds'>): string {
  return `每轮 ${moduleScoutsPerRound(state)} 名球探 · ${REGIONS.length} 个区域 · 每区域每轮最多 1 人 · 每次考察 +${moduleKnowledgeGain(state)} 知识度 · ${state.rounds} 轮`;
}
