/**
 * 关卡二《球探室》的纯规则代码。
 *
 * 结构接近“工人放置 + 信息成本”：球探数量有限、区域有容量、轮末收回，
 * 知识度决定报告精度。所有随机只来自 engine/rng.ts 的固定种子。
 */
import { recordEvent } from '../../engine/events';
import type { RngState } from '../../engine/rng';
import { createRng, isRngState, nextInt, normalizeSeed, reviveRng } from '../../engine/rng';
import type { EventLogEntry, EventState, Evidence, GameMode, LevelPhase, ShowcaseOptions } from '../../engine/types';
import { PHASE_ORDER, createEvidence } from '../../engine/types';

/* ==========================================================================
   区域与候选球员（全部虚构）
   ========================================================================== */

export type RegionId = 'local' | 'southern-europe' | 'northern-europe' | 'south-america';
export type ReportPrecision = 'unknown' | 'wide' | 'narrow' | 'precise';

export interface Region {
  id: RegionId;
  name: string;
  description: string;
}

export const REGIONS: Region[] = [
  { id: 'local', name: '本地球市', description: '距离最近，信息最容易核实；候选多，但竞争也最透明。' },
  { id: 'southern-europe', name: '南欧', description: '技术型球员密集；需要更长时间才能看清真实水平。' },
  { id: 'northern-europe', name: '北欧', description: '身体与纪律出色；比赛节奏与本地差异大。' },
  { id: 'south-america', name: '南美', description: '天赋上限高，但报告最难核实，适应风险也最大。' },
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
   知识度与报告精度
   ========================================================================== */

/** 每轮被考察一次，区域知识度 +40（两轮达到 80，进入“接近真实”档）。 */
export const KNOWLEDGE_GAIN = 40;
export const KNOWLEDGE_MAX = 100;
export const SCOUTS_PER_ROUND = 2;
export const ROUNDS_NORMAL = 2;
export const ROUNDS_FAST = 1;

/** 阈值：<35 只给很宽的模糊评价；35–74 较窄；≥75 接近真实（±3）。 */
export const PRECISION_WIDE_MAX = 34;
export const PRECISION_NARROW_MAX = 74;
export const PRECISION_PRECISE_MIN = 75;

export function reportPrecision(knowledge: number): ReportPrecision {
  if (knowledge <= 0) return 'unknown';
  if (knowledge <= PRECISION_WIDE_MAX) return 'wide';
  if (knowledge <= PRECISION_NARROW_MAX) return 'narrow';
  if (knowledge >= PRECISION_PRECISE_MIN) return 'precise';
  return 'narrow';
}

export function precisionLabel(precision: ReportPrecision): string {
  if (precision === 'unknown') return '未知';
  if (precision === 'wide') return '模糊';
  if (precision === 'narrow') return '较窄';
  return '接近真实';
}

export function precisionDescription(precision: ReportPrecision): string {
  if (precision === 'unknown') return '未考察过，只确认名字与位置。';
  if (precision === 'wide') return '知识度不足 35：范围很宽的模糊评价。';
  if (precision === 'narrow') return '知识度 35–74：区间缩小，但仍不能当精确值用。';
  return '知识度 75 以上：接近真实值（±3），仍不是精确值。';
}

export function gainKnowledge(knowledge: number): number {
  return Math.min(KNOWLEDGE_MAX, Math.max(0, Math.round(knowledge + KNOWLEDGE_GAIN)));
}

const HALF_WIDTH: Record<Exclude<ReportPrecision, 'unknown'>, number> = { wide: 18, narrow: 9, precise: 3 };

export interface AbilityRange {
  low: number;
  high: number;
}

/** 报告区间。低知识度只会得到更宽的区间；任何精度下都不会显示唯一精确值。 */
export function reportRange(overall: number, knowledge: number): AbilityRange | null {
  const precision = reportPrecision(knowledge);
  if (precision === 'unknown') return null;
  const half = HALF_WIDTH[precision];
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
  const overall = trueOverall(candidate);
  const range = reportRange(overall, knowledge);
  const summary = range
    ? `${precisionLabel(precision)}区间：综合能力 ${range.low}–${range.high}（知识度 ${knowledge}）`
    : '未知';
  return { candidateId: candidate.id, precision, knowledge, range, summary };
}

/* ==========================================================================
   状态
   ========================================================================== */

export interface ScoutingRoundRecord {
  round: number;
  regions: RegionId[];
  knowledgeBefore: Record<RegionId, number>;
  knowledgeAfter: Record<RegionId, number>;
}

export interface ScoutingState {
  version: 1;
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
  fault: { inspected: string[]; picked: string | null; done: boolean };
  diagnose: { resolved: boolean };
  installed: { limitedScouts: boolean; knowledgeReports: boolean };
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
  return Math.max(0, SCOUTS_PER_ROUND - state.dispatches.length);
}

export function reportRounds(state: ScoutingState): number {
  return state.rounds;
}

export function isSelectingCandidate(state: ScoutingState): boolean {
  return state.phase === 'verify' && state.round >= state.rounds && state.selectedCandidateId === null;
}

export function coveredRegions(state: ScoutingState): RegionId[] {
  return REGION_IDS.filter((region) => state.knowledge[region] > 0);
}

export function canEnterVerify(state: ScoutingState): boolean {
  return (
    state.phase === 'repair' &&
    state.installed.limitedScouts &&
    state.installed.knowledgeReports
  );
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
  if (!findCandidate(candidateId) || state.fault.inspected.includes(candidateId)) return state;
  const candidate = findCandidate(candidateId);
  if (!candidate) return state;
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
    note: '下一步安装有限球探与知识度报告。',
  });
}

export function startRepair(state: ScoutingState): ScoutingState {
  if (state.phase !== 'diagnose' || !state.diagnose.resolved) return state;
  const next: ScoutingState = { ...state, phase: 'repair' };
  return withEvent(next, 'repair', {
    action: 'start-repair',
    label: '开始维修：安装有限球探与知识度报告',
    before: { phase: 'diagnose' },
    after: { phase: 'repair' },
    note: '两个模块都装上，才能开始派遣。',
  });
}

export function installLimitedScouts(state: ScoutingState): ScoutingState {
  if (state.phase !== 'repair' || state.installed.limitedScouts) return state;
  const next: ScoutingState = { ...state, installed: { ...state.installed, limitedScouts: true } };
  return withEvent(next, 'repair', {
    action: 'install-limited-scouts',
    label: '安装有限球探：2 名球探、4 个区域、轮末收回',
    before: { limitedScouts: 'false' },
    after: { limitedScouts: 'true', scouts: SCOUTS_PER_ROUND },
    note: '每轮每名球探只能去一个区域；同一区域同一轮只能派 1 人。',
  });
}

export function installKnowledgeReports(state: ScoutingState): ScoutingState {
  if (state.phase !== 'repair' || state.installed.knowledgeReports) return state;
  const next: ScoutingState = { ...state, installed: { ...state.installed, knowledgeReports: true } };
  return withEvent(next, 'repair', {
    action: 'install-knowledge-reports',
    label: '安装知识度报告：考察让信息一轮轮变清楚',
    before: { knowledgeReports: 'false' },
    after: { knowledgeReports: 'true', gain: KNOWLEDGE_GAIN },
    note: '区域知识度 0→100；低于 35 只有模糊区间，35–74 缩小区间，75 以上才接近真实值。',
  });
}

export function startVerify(state: ScoutingState): ScoutingState {
  if (!canEnterVerify(state)) return state;
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
    label: `开始派遣：${state.rounds} 轮，每轮 ${SCOUTS_PER_ROUND} 名球探`,
    before: { phase: 'repair' },
    after: { phase: 'verify', rounds: state.rounds, scouts: SCOUTS_PER_ROUND },
    note: '轮末球探收回，知识度留在区域里；同一区域每轮最多 1 人。',
  });
}

export function canAssignScout(state: ScoutingState, region: unknown): region is RegionId {
  if (state.phase !== 'verify') return false;
  if (!state.installed.limitedScouts || !state.installed.knowledgeReports) return false;
  if (state.round >= state.rounds) return false;
  if (!isRegionId(region)) return false;
  if (state.dispatches.includes(region)) return false;
  return state.dispatches.length < SCOUTS_PER_ROUND;
}

export function assignScout(state: ScoutingState, region: RegionId): ScoutingState {
  if (!canAssignScout(state, region)) return state;
  const next: ScoutingState = { ...state, dispatches: [...state.dispatches, region] };
  return withEvent(next, 'verify', {
    action: 'assign-scout',
    label: `派遣球探：${regionName(region)}`,
    before: { scoutsAvailable: SCOUTS_PER_ROUND - state.dispatches.length, round: state.round + 1 },
    after: { scoutsAvailable: SCOUTS_PER_ROUND - next.dispatches.length, round: state.round + 1 },
    delta: `剩余球探 ${SCOUTS_PER_ROUND - next.dispatches.length} 名`,
    note: '球探派出后不算完成，轮末才收回；同一轮不能再来这个区域。',
  });
}

export function endRound(state: ScoutingState): ScoutingState {
  if (state.phase !== 'verify') return state;
  if (state.round >= state.rounds) return state;
  if (state.dispatches.length !== SCOUTS_PER_ROUND) return state;
  const before = { ...state.knowledge };
  const after = { ...state.knowledge };
  for (const region of state.dispatches) {
    after[region] = gainKnowledge(after[region]);
  }
  const record: ScoutingRoundRecord = {
    round: state.round + 1,
    regions: [...state.dispatches],
    knowledgeBefore: before,
    knowledgeAfter: after,
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
    delta: state.dispatches.map((region) => `${regionName(region)} +${KNOWLEDGE_GAIN}`).join(' · '),
    note: '同一区域每轮最多被考察一次；知识度越高，报告区间越窄。',
  });
}

export function selectCandidate(state: ScoutingState, candidateId: string): ScoutingState {
  if (state.phase !== 'verify') return state;
  if (state.round < state.rounds) return state;
  if (state.selectedCandidateId !== null) return state;
  if (!state.installed.limitedScouts || !state.installed.knowledgeReports) return state;
  const candidate = findCandidate(candidateId);
  if (!candidate) return state;
  const report = candidateReport(candidate, state.knowledge[candidate.region]);
  const next: ScoutingState = {
    ...state,
    selectedCandidateId: candidateId,
    evidence: { ...state.evidence, operatedMechanic: true },
  };
  return withEvent(next, 'verify', {
    action: 'select-candidate',
    label: `根据报告加入候选名单：${candidate.name}`,
    before: { selected: 'none' },
    after: { selected: candidate.name, report: report.summary },
    delta: report.precision === 'unknown' ? '未知区域' : `精度 ${precisionLabel(report.precision)}`,
    note: '这次选择只能依据当时可见的报告；真实能力在归档对比里才揭晓。',
  });
}

export function openTransfer(state: ScoutingState): ScoutingState {
  if (state.phase !== 'verify' || state.selectedCandidateId === null) return state;
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

export function canComplete(state: ScoutingState): boolean {
  if (state.phase !== 'summary' || state.completed) return false;
  if (!state.installed.limitedScouts || !state.installed.knowledgeReports) return false;
  if (state.round < state.rounds) return false;
  if (state.selectedCandidateId === null) return false;
  if (state.mode === 'showcase') return true;
  return state.fault.done && state.diagnose.resolved && state.transfer.resolved;
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
    .map((candidate) => candidateReport(candidate, state.knowledge[candidate.region]));
}

export interface ScoutingComparisonRow {
  label: string;
  fault: string;
  fixed: string;
}

export function buildScoutingComparison(state: ScoutingState): ScoutingComparisonRow[] {
  const faultPicked = state.fault.picked ? findCandidate(state.fault.picked) : null;
  const selected = state.selectedCandidateId ? findCandidate(state.selectedCandidateId) : null;
  const selectedReport = selected ? candidateReport(selected, state.knowledge[selected.region]) : null;
  const covered = coveredRegions(state).map((region) => regionName(region)).join('、') || '没有区域';
  return [
    {
      label: '信息范围',
      fault: '5 名候选的全部精确属性，一点即见',
      fixed: `${covered} 有报告；其余区域仍是「未知」`,
    },
    {
      label: '考察成本',
      fault: '0 次派遣、0 轮等待',
      fixed: `${state.round} 轮 × ${SCOUTS_PER_ROUND} 名球探 = ${state.round * SCOUTS_PER_ROUND} 次区域考察`,
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
  const selectedReport = selected ? candidateReport(selected, state.knowledge[selected.region]) : null;
  const covered = coveredRegions(state).map((region) => regionName(region));
  return [
    '改了哪条规则：把「点一下就看到全部精确属性」改成「2 名球探、每轮最多考察 2 个区域、同一区域每轮 1 人、轮末收回」，并让区域知识度决定报告精度。',
    `改变了什么选择：先派球探去哪些区域、接受报告从模糊区间逐轮变窄，而不是等一个精确数字。最终选了 ${
      selected ? `${selected.name}（${selected.position}）` : '一名候选'
    }${selectedReport ? `，依据是${selectedReport.summary}` : ''}。`,
    `产生了什么代价：${state.rounds} 轮最多只能覆盖 ${state.round * SCOUTS_PER_ROUND} 个区域次（实际考察：${
      covered.join('、') || '没有区域'
    }），没考察的区域只能标「未知」；知识度不足时必须接受更宽的区间。`,
  ];
}

export function buildCompletionResult(state: ScoutingState): { evidence: Evidence; summary: string[] } {
  return { evidence: { ...state.evidence }, summary: buildArchiveSummary(state) };
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
    version: 1,
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
    fault: { inspected: [], picked: null, done: false },
    diagnose: { resolved: false },
    installed: { limitedScouts: false, knowledgeReports: false },
    selectedCandidateId: null,
    transfer: { resolved: false, skipped: false },
    evidence: createEvidence(),
    eventLog: [],
    completed: false,
  };
}

/**
 * 展示模式按 startPhase 预填前置步骤：
 * repair = 已诊断；verify = 两个模块已安装，可以直接开始派遣。
 * 预填不会把玩家没做过的步骤写成证据。
 */
export function createInitialScoutingState(options: ScoutingInitOptions, seed: number): ScoutingState {
  const phase = requestedPhase(options);
  const state = createBaseState(options, seed, phase);
  if (phase === 'commission' || phase === 'faultPlay') return state;
  if (phase === 'diagnose') {
    return { ...state, fault: { inspected: SCOUT_CANDIDATES.map((candidate) => candidate.id), picked: SCOUT_CANDIDATES[0].id, done: true } };
  }
  if (phase === 'repair') {
    return {
      ...state,
      fault: { inspected: SCOUT_CANDIDATES.map((candidate) => candidate.id), picked: SCOUT_CANDIDATES[0].id, done: true },
      diagnose: { resolved: true },
    };
  }
  return {
    ...state,
    phase: 'verify',
    fault: { inspected: SCOUT_CANDIDATES.map((candidate) => candidate.id), picked: SCOUT_CANDIDATES[0].id, done: true },
    diagnose: { resolved: true },
    installed: { limitedScouts: true, knowledgeReports: true },
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

/** 校验并恢复存档；任何结构不合法都返回 null，由调用方从头开始。 */
export function reviveScoutingState(raw: unknown, options: ScoutingInitOptions): ScoutingState | null {
  if (!isObject(raw)) return null;
  if (raw.version !== 1) return null;
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
  if (!isFiniteNumber(raw.round) || raw.round < 0 || raw.round > 4) return null;
  if (!isFiniteNumber(raw.rounds) || (raw.rounds !== ROUNDS_NORMAL && raw.rounds !== ROUNDS_FAST)) return null;
  if (raw.round > raw.rounds) return null;
  if (!Array.isArray(raw.dispatches) || !raw.dispatches.every(isRegionId)) return null;
  if (new Set(raw.dispatches).size !== raw.dispatches.length) return null;
  if (raw.dispatches.length > SCOUTS_PER_ROUND) return null;
  if (!Array.isArray(raw.history) || !raw.history.every(isRoundRecord)) return null;
  if (raw.history.length !== raw.round) return null;
  const fault = raw.fault;
  if (!isObject(fault)) return null;
  if (!Array.isArray(fault.inspected) || !fault.inspected.every((id) => typeof id === 'string' && findCandidate(id) !== null)) return null;
  if (!(fault.picked === null || (typeof fault.picked === 'string' && findCandidate(fault.picked) !== null))) return null;
  if (!isBoolean(fault.done)) return null;
  const diagnose = raw.diagnose;
  if (!isObject(diagnose) || !isBoolean(diagnose.resolved)) return null;
  const installed = raw.installed;
  if (!isObject(installed) || !isBoolean(installed.limitedScouts) || !isBoolean(installed.knowledgeReports)) return null;
  if (!(raw.selectedCandidateId === null || (typeof raw.selectedCandidateId === 'string' && findCandidate(raw.selectedCandidateId) !== null))) {
    return null;
  }
  const transfer = raw.transfer;
  if (!isObject(transfer) || !isBoolean(transfer.resolved) || !isBoolean(transfer.skipped)) return null;
  if (!isEvidenceShape(raw.evidence)) return null;
  if (!isValidEventLog(raw.eventLog)) return null;
  if (!isBoolean(raw.completed)) return null;
  // 交叉校验：没装模块不能有派遣与选择；没结束全部轮次不能选候选。
  if ((raw.dispatches.length > 0 || raw.selectedCandidateId !== null) && (!installed.limitedScouts || !installed.knowledgeReports)) {
    return null;
  }
  if (raw.selectedCandidateId !== null && raw.round < raw.rounds) return null;
  if ((raw.phase === 'transfer' || raw.phase === 'summary') && raw.selectedCandidateId === null) return null;

  return {
    version: 1,
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
    })),
    fault: {
      inspected: [...(fault.inspected as string[])],
      picked: fault.picked as string | null,
      done: fault.done,
    },
    diagnose: { resolved: diagnose.resolved },
    installed: { limitedScouts: installed.limitedScouts, knowledgeReports: installed.knowledgeReports },
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
export function knowledgeSummary(state: ScoutingState, region: RegionId): string {
  const knowledge = state.knowledge[region];
  const precision = reportPrecision(knowledge);
  return `${precisionLabel(precision)} · ${precisionDescription(precision)}`;
}
