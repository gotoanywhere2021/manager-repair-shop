/**
 * 关卡一《战术板》的纯规则代码（v2 可玩性升级版）。
 *
 * v2 变化：
 * - 模块池：两个槽位各有两个选择（正确模块 + 有诱惑力但错误/有副作用的模块）。
 * - 验证前可自由安装/卸载模块，允许不装齐正确模块就开始验证，结果会真实变差。
 * - 验证有明确目标；未达成时给出具体原因，可清空成绩回到维修台重新配置。
 * - 完成时产出真实俱乐部时间线数据（clubUpdate）。
 *
 * 本文件不依赖 React / DOM；随机只用 engine/rng.ts。
 */
import { recordEvent } from '../../engine/events';
import type { RngState } from '../../engine/rng';
import { createRng, isRngState, nextInt, nextUnit, normalizeSeed, reviveRng } from '../../engine/rng';
import type {
  ClubPatch,
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
   基础类型
   ========================================================================== */

export type PossessionShapeId = '4-3-3' | '3-2-5' | '4-2-3-1';
export type OutShapeId = '4-4-2-mid' | '4-1-4-1' | '5-3-2-low';
export type FullbackDutyId = 'overlap' | 'invert';
export type PivotDutyId = 'single' | 'double';
export type FaultInstructionId = 'press' | 'balance' | 'drop';
export type VerifyInstructionId = 'press-strong' | 'cover-wing' | 'shrink-center';
export type AttackSide = 'right' | 'center' | 'left';

export type ShapeSlotModuleId = 'dual-shape' | 'man-marking';
export type AttackSlotModuleId = 'role-duties' | 'long-ball';
export type TacticsModuleId = ShapeSlotModuleId | AttackSlotModuleId;
export type TacticsSlot = 'shape' | 'attack';

export interface TacticsMetrics {
  progression: number;
  wingProtection: number;
  centralProtection: number;
  stamina: number;
}

export interface TacticsConfig {
  possessionShape: PossessionShapeId;
  outOfPossessionShape: OutShapeId;
  fullbackDuty: FullbackDutyId;
  pivotDuty: PivotDutyId;
}

export interface TacticsLoadout {
  shape: ShapeSlotModuleId | null;
  attack: AttackSlotModuleId | null;
}

export interface TacticsState {
  version: 3;
  phase: LevelPhase;
  mode: GameMode;
  fastPlay: boolean;
  seed: number;
  rng: RngState;
  config: TacticsConfig;
  loadout: TacticsLoadout;
  /** 进入本关时俱乐部剩余转会预算（百万欧）；展示模式为默认 45。 */
  budget: number;
  /** 本关验证未达成后返工次数，每次扣 €1M。 */
  failureCount: number;
  fault: { played: FaultStageResult[]; done: boolean; demoPreloaded: boolean };
  diagnose: { resolved: boolean };
  verify: { results: VerifyStageResult[]; done: boolean; attempts: number };
  transfer: { resolved: boolean; skipped: boolean };
  evidence: Evidence;
  eventLog: EventLogEntry[];
  completed: boolean;
}

export interface TacticsInitOptions {
  mode: GameMode;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
  /** 正常模式由 props.club.transferBudget 传入；不传或展示模式用默认 45。 */
  startingBudget?: number;
}

/* ==========================================================================
   模块池：两个槽位，每个槽位二选一
   ========================================================================== */

export interface TacticsModuleDefinition {
  id: TacticsModuleId;
  slot: TacticsSlot;
  name: string;
  englishName: string;
  description: string;
  /** 诚实的副作用说明，直接显示在模块卡上。 */
  sideEffect: string;
  /** 对验证指标的真实影响，一句话。 */
  effect: string;
  correct: boolean;
}

export const TACTICS_MODULES: TacticsModuleDefinition[] = [
  {
    id: 'dual-shape',
    slot: 'shape',
    name: '双形态战术',
    englishName: 'In & Out of Possession',
    description: '控球时与无球时各用一套阵型：有球形态负责推进与创造，无球形态负责保护与压迫。',
    sideEffect: '两套形态切换需要训练与角色熟悉度；职责冲突会让球员在两套任务之间犹豫。',
    effect: '验证时用你设置的有球/无球两套阵型计算推进与保护。',
    correct: true,
  },
  {
    id: 'man-marking',
    slot: 'shape',
    name: '全场人盯人',
    englishName: 'Full-Pitch Man Marking',
    description: '每个球员盯死一个人，靠抢断和压迫把球抢回来，看起来很有侵略性。',
    sideEffect: '边路保护 −30、中路保护 −12、体能 +24；只要一次盯丢，身后就是整片空当。',
    effect: '推进 +12、每阶段多 1 次抢断机会，但保护与体能明显变差。',
    correct: false,
  },
  {
    id: 'role-duties',
    slot: 'attack',
    name: '职责分工',
    englishName: 'Role Duties',
    description: '同一位置可以设置不同职责：边后卫套边或内收，后腰单人保护或双人保护。',
    sideEffect: '职责越激进，控球收益越高，丢球后的回防距离也越长。',
    effect: '验证时叠加你选择的边后卫/后腰职责指标。',
    correct: true,
  },
  {
    id: 'long-ball',
    slot: 'attack',
    name: '长传冲吊',
    englishName: 'Route One',
    description: '后场直接找中锋，跳过中场组织，全队少跑很多。',
    sideEffect: '推进 −22、每阶段少 1 次创造机会、中路保护 −6；唯一优点是体能 −10。',
    effect: '推进与创造机会下降，但省体能。',
    correct: false,
  },
];

export const MAN_MARKING_DELTAS: TacticsMetrics = {
  progression: 12,
  wingProtection: -30,
  centralProtection: -12,
  stamina: 24,
};

export const LONG_BALL_DELTAS: TacticsMetrics = {
  progression: -22,
  wingProtection: 4,
  centralProtection: -6,
  stamina: -10,
};

export const MAN_MARKING_CHANCE_BONUS = 1;
export const LONG_BALL_CHANCE_PENALTY = 1;

/** 俱乐部默认转会预算（百万欧）。 */
export const DEFAULT_TRANSFER_BUDGET = 45;
/** 每次验证未达成后的返工成本（百万欧）。 */
export const RETRY_COST_MILLIONS = 1;

export function normalizeBudget(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TRANSFER_BUDGET;
  return Math.max(0, Math.round(value * 10) / 10);
}

/** 本关结束时可提交给俱乐部的剩余转会预算（不会为负）。 */
export function remainingBudget(state: Pick<TacticsState, 'budget' | 'failureCount'>): number {
  return Math.max(0, Math.round((state.budget - state.failureCount * RETRY_COST_MILLIONS) * 10) / 10);
}

/** 预算展示：整数不带小数，返工扣款为 .5 时保留一位。 */
export function formatBudgetM(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function findTacticsModule(id: TacticsModuleId): TacticsModuleDefinition {
  const module = TACTICS_MODULES.find((item) => item.id === id);
  if (!module) throw new Error(`未知战术模块：${id}`);
  return module;
}

export function moduleSlotOf(id: TacticsModuleId): TacticsSlot {
  return findTacticsModule(id).slot;
}

export function loadoutModuleNames(loadout: TacticsLoadout): string[] {
  const names: string[] = [];
  if (loadout.shape) names.push(findTacticsModule(loadout.shape).name);
  if (loadout.attack) names.push(findTacticsModule(loadout.attack).name);
  return names;
}

/* ==========================================================================
   阵型与职责
   ========================================================================== */

export interface ShapeOption<T extends string> {
  id: T;
  name: string;
  description: string;
  metrics: TacticsMetrics;
}

export const POSSESSION_SHAPE_OPTIONS: ShapeOption<PossessionShapeId>[] = [
  {
    id: '4-3-3',
    name: '4-3-3',
    description: '三前锋拉开宽度，边后卫可以套上；中场三人覆盖二点。',
    metrics: { progression: 78, wingProtection: 56, centralProtection: 52, stamina: 55 },
  },
  {
    id: '3-2-5',
    name: '3-2-5',
    description: '五人压在前场，中路人数最多；身后空间与体能压力也最大。',
    metrics: { progression: 92, wingProtection: 42, centralProtection: 44, stamina: 78 },
  },
  {
    id: '4-2-3-1',
    name: '4-2-3-1',
    description: '前场四人保持层次，推进稳但不够锋利；丢球时站位更容易落回。',
    metrics: { progression: 70, wingProtection: 66, centralProtection: 64, stamina: 52 },
  },
];

export const OUT_SHAPE_OPTIONS: ShapeOption<OutShapeId>[] = [
  {
    id: '4-4-2-mid',
    name: '4-4-2 中位块',
    description: '两条四人线保持在中场附近，边路有人但禁区正面仍有空间。',
    metrics: { progression: 48, wingProtection: 70, centralProtection: 66, stamina: 56 },
  },
  {
    id: '4-1-4-1',
    name: '4-1-4-1',
    description: '单后腰保护禁区正面，两条线之间更紧凑；边路交给边前卫回追。',
    metrics: { progression: 52, wingProtection: 66, centralProtection: 76, stamina: 64 },
  },
  {
    id: '5-3-2-low',
    name: '5-3-2 低位块',
    description: '五后卫落进禁区，牺牲推进换边路与中路的双重保护。',
    metrics: { progression: 36, wingProtection: 80, centralProtection: 86, stamina: 44 },
  },
];

export const FULLBACK_DUTY_OPTIONS: ShapeOption<FullbackDutyId>[] = [
  {
    id: 'overlap',
    name: '套边',
    description: '进攻时压上提供宽度，丢球后要跑更长的距离回追。',
    metrics: { progression: 10, wingProtection: 8, centralProtection: -4, stamina: 12 },
  },
  {
    id: 'invert',
    name: '内收',
    description: '进攻时进入中场形成人数优势，边路宽度交给边锋。',
    metrics: { progression: 2, wingProtection: -4, centralProtection: 10, stamina: 4 },
  },
];

export const PIVOT_DUTY_OPTIONS: ShapeOption<PivotDutyId>[] = [
  {
    id: 'single',
    name: '单后腰',
    description: '一个人扫荡禁区前沿，多一个前场接应点，但身后空当更明显。',
    metrics: { progression: 8, wingProtection: -2, centralProtection: -8, stamina: 6 },
  },
  {
    id: 'double',
    name: '双后腰',
    description: '两人轮流保护中路与边路内线，推进人数减少。',
    metrics: { progression: -4, wingProtection: 4, centralProtection: 14, stamina: 2 },
  },
];

/** 故障版只有一套 4-4-2：控球和丢球共用同一套站位。 */
export const FAULT_METRICS: TacticsMetrics = {
  progression: 48,
  wingProtection: 38,
  centralProtection: 55,
  stamina: 58,
};

export const DEFAULT_TACTICS_CONFIG: TacticsConfig = {
  possessionShape: '4-3-3',
  outOfPossessionShape: '4-4-2-mid',
  fullbackDuty: 'overlap',
  pivotDuty: 'double',
};

export function clampMetric(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function findShape<T extends string>(options: ShapeOption<T>[], id: T): ShapeOption<T> {
  const found = options.find((item) => item.id === id);
  if (!found) throw new Error(`未知阵型或职责：${id}`);
  return found;
}

export function shapeMetrics(possession: PossessionShapeId, out: OutShapeId): TacticsMetrics {
  const pos = findShape(POSSESSION_SHAPE_OPTIONS, possession).metrics;
  const outMetrics = findShape(OUT_SHAPE_OPTIONS, out).metrics;
  return {
    progression: clampMetric(pos.progression * 0.6 + outMetrics.progression * 0.4),
    wingProtection: clampMetric(pos.wingProtection * 0.35 + outMetrics.wingProtection * 0.65),
    centralProtection: clampMetric(pos.centralProtection * 0.35 + outMetrics.centralProtection * 0.65),
    stamina: clampMetric((pos.stamina + outMetrics.stamina) / 2),
  };
}

export function dutyMetrics(fullback: FullbackDutyId, pivot: PivotDutyId): TacticsMetrics {
  const fb = findShape(FULLBACK_DUTY_OPTIONS, fullback).metrics;
  const pv = findShape(PIVOT_DUTY_OPTIONS, pivot).metrics;
  return {
    progression: fb.progression + pv.progression,
    wingProtection: fb.wingProtection + pv.wingProtection,
    centralProtection: fb.centralProtection + pv.centralProtection,
    stamina: fb.stamina + pv.stamina,
  };
}

export function addMetrics(base: TacticsMetrics, delta: TacticsMetrics): TacticsMetrics {
  return {
    progression: clampMetric(base.progression + delta.progression),
    wingProtection: clampMetric(base.wingProtection + delta.wingProtection),
    centralProtection: clampMetric(base.centralProtection + delta.centralProtection),
    stamina: clampMetric(base.stamina + delta.stamina),
  };
}

/** 玩家当前的模块组合下，验证时真正生效的指标。 */
export function verificationMetrics(state: Pick<TacticsState, 'config' | 'loadout'>): TacticsMetrics {
  let metrics: TacticsMetrics = { ...FAULT_METRICS };
  if (state.loadout.shape === 'dual-shape') {
    metrics = shapeMetrics(state.config.possessionShape, state.config.outOfPossessionShape);
  } else if (state.loadout.shape === 'man-marking') {
    metrics = addMetrics(FAULT_METRICS, MAN_MARKING_DELTAS);
  }
  if (state.loadout.attack === 'role-duties') {
    metrics = addMetrics(metrics, dutyMetrics(state.config.fullbackDuty, state.config.pivotDuty));
  } else if (state.loadout.attack === 'long-ball') {
    metrics = addMetrics(metrics, LONG_BALL_DELTAS);
  }
  return metrics;
}

/** 错误模块还会改变每阶段创造机会的次数，而不是只改指标。 */
export function verificationChanceModifiers(state: Pick<TacticsState, 'loadout'>): { bonus: number; penalty: number } {
  return {
    bonus: state.loadout.shape === 'man-marking' ? MAN_MARKING_CHANCE_BONUS : 0,
    penalty: state.loadout.attack === 'long-ball' ? LONG_BALL_CHANCE_PENALTY : 0,
  };
}

export function metricDelta(after: TacticsMetrics, before: TacticsMetrics): TacticsMetrics {
  return {
    progression: after.progression - before.progression,
    wingProtection: after.wingProtection - before.wingProtection,
    centralProtection: after.centralProtection - before.centralProtection,
    stamina: after.stamina - before.stamina,
  };
}

export function formatMetricDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

/* ==========================================================================
   故障版：只有一套 4-4-2
   ========================================================================== */

export interface FaultInstructionOption {
  id: FaultInstructionId;
  name: string;
  hint: string;
}

export const FAULT_INSTRUCTIONS: FaultInstructionOption[] = [
  { id: 'press', name: '压上', hint: '把整条防线前压，想抢回主动。' },
  { id: 'balance', name: '平衡', hint: '保持原来的站位，等对手先犯错。' },
  { id: 'drop', name: '回收', hint: '整条防线退深，先别再丢球。' },
];

export interface FaultStageResult {
  stage: number;
  instruction: FaultInstructionId;
  ourChances: number;
  opponentChances: number;
  opponentWingChances: number;
  goalsAgainst: number;
  wingGoalsAgainst: number;
  note: string;
}

const FAULT_STAGE_TABLE: Record<FaultInstructionId, Omit<FaultStageResult, 'stage' | 'instruction' | 'note'>> = {
  press: { ourChances: 2, opponentChances: 5, opponentWingChances: 4, goalsAgainst: 2, wingGoalsAgainst: 2 },
  balance: { ourChances: 1, opponentChances: 4, opponentWingChances: 4, goalsAgainst: 1, wingGoalsAgainst: 1 },
  drop: { ourChances: 1, opponentChances: 4, opponentWingChances: 4, goalsAgainst: 1, wingGoalsAgainst: 1 },
};

const FAULT_NOTES: Record<FaultInstructionId, string> = {
  press: '压上以后身后空间更大；但边路的空当来自同一套 4-4-2 的站位，不会因为喊话消失。',
  balance: '保持原位只是让损失变得平均；边路仍然由同一名边后卫负责整条边线。',
  drop: '回收把整条防线压低，禁区里人多了一点，但边路还是同一批人、同一个站位。',
};

export function isFaultInstruction(value: unknown): value is FaultInstructionId {
  return value === 'press' || value === 'balance' || value === 'drop';
}

export function faultInstructionName(id: FaultInstructionId): string {
  return FAULT_INSTRUCTIONS.find((item) => item.id === id)?.name ?? id;
}

export function simulateFaultStage(instruction: FaultInstructionId, stage: number): FaultStageResult {
  const row = FAULT_STAGE_TABLE[instruction];
  return { stage, instruction, note: FAULT_NOTES[instruction], ...row };
}

export function simulateFaultStages(stageCount: number): FaultStageResult[] {
  const pattern: FaultInstructionId[] = ['balance', 'drop', 'press', 'balance'];
  const results: FaultStageResult[] = [];
  for (let index = 0; index < stageCount; index += 1) {
    results.push(simulateFaultStage(pattern[index % pattern.length], index + 1));
  }
  return results;
}

/* ==========================================================================
   修复版：对手固定倾向 + 模块指标 + 阶段指令 + 少量随机波动
   ========================================================================== */

export interface VerifyInstructionOption {
  id: VerifyInstructionId;
  name: string;
  hint: string;
}

export const VERIFY_INSTRUCTIONS: VerifyInstructionOption[] = [
  { id: 'press-strong', name: '压上强侧', hint: '把防守重心压向对手的强侧，主动抢回球权。' },
  { id: 'cover-wing', name: '保护边路', hint: '边锋回收、边后卫不再盲目前压，先守住边路。' },
  { id: 'shrink-center', name: '收缩中路', hint: '放弃边路一点空间，把禁区正面堵死。' },
];

export const OPPONENT_TENDENCY: { side: AttackSide; label: string; chance: number }[] = [
  { side: 'right', label: '右路', chance: 60 },
  { side: 'center', label: '中路', chance: 20 },
  { side: 'left', label: '左路', chance: 20 },
];

export interface VerifyStageResult {
  stage: number;
  instruction: VerifyInstructionId;
  attackSide: AttackSide;
  chancesFor: number;
  goalsFor: number;
  chancesAgainst: number;
  goalsAgainst: number;
  wingGoalsAgainst: number;
  protection: number;
  note: string;
}

export function isVerifyInstruction(value: unknown): value is VerifyInstructionId {
  return value === 'press-strong' || value === 'cover-wing' || value === 'shrink-center';
}

export function verifyInstructionName(id: VerifyInstructionId): string {
  return VERIFY_INSTRUCTIONS.find((item) => item.id === id)?.name ?? id;
}

export function attackSideName(side: AttackSide): string {
  if (side === 'right') return '右路';
  if (side === 'left') return '左路';
  return '中路';
}

function instructionProtection(instruction: VerifyInstructionId, side: AttackSide): number {
  if (instruction === 'press-strong') return 8;
  if (instruction === 'cover-wing') return side === 'center' ? -4 : 16;
  return side === 'center' ? 16 : -8;
}

function instructionAttack(instruction: VerifyInstructionId): number {
  if (instruction === 'press-strong') return 10;
  if (instruction === 'cover-wing') return -6;
  return -2;
}

function clampProtection(value: number): number {
  return Math.min(95, Math.max(5, Math.round(value)));
}

/** 只读的防线估计：界面用它解释「这一侧保护得怎么样」。 */
export function sideProtection(metrics: TacticsMetrics, side: AttackSide, instruction: VerifyInstructionId): number {
  const base = side === 'center' ? metrics.centralProtection : metrics.wingProtection;
  return clampProtection(base + instructionProtection(instruction, side));
}

export interface VerifySimulationInput {
  metrics: TacticsMetrics;
  /** 人盯人每阶段多出的抢断机会。 */
  chanceBonus?: number;
  /** 长传冲吊每阶段少掉的机会。 */
  chancePenalty?: number;
}

export interface VerifySimulation {
  result: VerifyStageResult;
  rng: RngState;
}

/**
 * 计算一个比赛阶段。每次抽取 4 个随机数：进攻方向、波动、是否失球、是否进球。
 * 结果只由当前指标、阶段指令和随机数决定。
 */
export function simulateVerifyStage(
  input: VerifySimulationInput,
  instruction: VerifyInstructionId,
  stage: number,
  rng: RngState,
): VerifySimulation {
  const sideDraw = nextInt(rng, 100);
  const side: AttackSide = sideDraw.value < 60 ? 'right' : sideDraw.value < 80 ? 'center' : 'left';
  const varianceDraw = nextUnit(sideDraw.rng);
  const variance = Math.round((varianceDraw.value - 0.5) * 16);
  const metrics = input.metrics;
  const isWing = side !== 'center';
  const protection = sideProtection(metrics, side, instruction);

  const danger = Math.min(0.5, Math.max(0.03, 0.03 + ((100 - protection) / 100) * 0.42));
  const concedeDraw = nextUnit(varianceDraw.rng);
  const goalsAgainst = concedeDraw.value < danger * danger ? 2 : concedeDraw.value < danger ? 1 : 0;

  const attackPower = Math.max(20, metrics.progression + instructionAttack(instruction));
  const rawChances = Math.round((attackPower + variance * 0.4) / 28);
  const chancesFor = Math.min(
    4,
    Math.max(1, rawChances + (input.chanceBonus ?? 0) - (input.chancePenalty ?? 0)),
  );
  const finishDraw = nextUnit(concedeDraw.rng);
  const finishRate = Math.min(0.4, Math.max(0.06, attackPower / 260));
  const goalsFor = finishDraw.value < finishRate ? 1 : 0;

  const chancesAgainst = isWing ? 3 : 2;
  const note = isWing
    ? `对手第 ${stage} 阶段从${attackSideName(side)}进攻；这一侧的保护数值是 ${protection}。`
    : `对手第 ${stage} 阶段改从中路进攻；这一侧的保护数值是 ${protection}。`;

  return {
    result: {
      stage,
      instruction,
      attackSide: side,
      chancesFor,
      goalsFor,
      chancesAgainst,
      goalsAgainst,
      wingGoalsAgainst: isWing ? goalsAgainst : 0,
      protection,
      note,
    },
    rng: finishDraw.rng,
  };
}

export function simulateVerifyStages(
  input: VerifySimulationInput,
  instruction: VerifyInstructionId,
  stageCount: number,
  rng: RngState,
): { results: VerifyStageResult[]; rng: RngState } {
  const results: VerifyStageResult[] = [];
  let currentRng = rng;
  for (let index = 0; index < stageCount; index += 1) {
    const simulation = simulateVerifyStage(input, instruction, index + 1, currentRng);
    results.push(simulation.result);
    currentRng = simulation.rng;
  }
  return { results, rng: currentRng };
}

/* ==========================================================================
   验证目标
   ========================================================================== */

export const TACTICS_TARGETS = {
  /** 每阶段至少创造 2 次机会（按实际阶段数换算总额）。 */
  chancesPerStage: 2,
  goalsAgainstMax: 2,
  wingGoalsAgainstMax: 1,
  staminaMax: 78,
};

export type TacticsTargetId = 'modules' | 'chances' | 'goals' | 'wing' | 'stamina';

export interface TargetCheck {
  id: TacticsTargetId;
  label: string;
  requirement: string;
  actual: string;
  met: boolean;
}

export interface MatchTotals {
  chancesFor: number;
  goalsFor: number;
  chancesAgainst: number;
  goalsAgainst: number;
  wingGoalsAgainst: number;
}

function emptyTotals(): MatchTotals {
  return { chancesFor: 0, goalsFor: 0, chancesAgainst: 0, goalsAgainst: 0, wingGoalsAgainst: 0 };
}

export function faultTotals(results: FaultStageResult[]): MatchTotals {
  return results.reduce<MatchTotals>((totals, result) => {
    totals.chancesFor += result.ourChances;
    totals.goalsFor += 0;
    totals.chancesAgainst += result.opponentChances;
    totals.goalsAgainst += result.goalsAgainst;
    totals.wingGoalsAgainst += result.wingGoalsAgainst;
    return totals;
  }, emptyTotals());
}

export function verifyTotals(results: VerifyStageResult[]): MatchTotals {
  return results.reduce<MatchTotals>((totals, result) => {
    totals.chancesFor += result.chancesFor;
    totals.goalsFor += result.goalsFor;
    totals.chancesAgainst += result.chancesAgainst;
    totals.goalsAgainst += result.goalsAgainst;
    totals.wingGoalsAgainst += result.wingGoalsAgainst;
    return totals;
  }, emptyTotals());
}

export interface TacticsVerification {
  /** 比赛阶段是否已经全部完成。 */
  done: boolean;
  passed: boolean;
  totals: MatchTotals;
  metrics: TacticsMetrics;
  targets: TargetCheck[];
  failed: TargetCheck[];
}

export function evaluateTacticsVerification(state: TacticsState): TacticsVerification {
  const done = state.verify.done && state.verify.results.length >= requiredStages(state);
  const stageCount = requiredStages(state);
  const chancesRequired = stageCount * TACTICS_TARGETS.chancesPerStage;
  const totals = verifyTotals(state.verify.results);
  const metrics = verificationMetrics(state);
  const installedNames = loadoutModuleNames(state.loadout);
  const modulesCorrect = state.loadout.shape === 'dual-shape' && state.loadout.attack === 'role-duties';

  const targets: TargetCheck[] = [
    {
      id: 'modules',
      label: '维修结构完整',
      requirement: '两套站位与职责设置都已就位',
      actual: installedNames.length > 0 ? `已安装：${installedNames.join('、')}` : '没有安装任何模块',
      met: modulesCorrect,
    },
    {
      id: 'chances',
      label: '创造机会',
      requirement: `≥ ${chancesRequired} 次（每阶段至少 ${TACTICS_TARGETS.chancesPerStage} 次）`,
      actual: `${totals.chancesFor} 次`,
      met: totals.chancesFor >= chancesRequired,
    },
    {
      id: 'goals',
      label: '失球',
      requirement: `≤ ${TACTICS_TARGETS.goalsAgainstMax} 个`,
      actual: `${totals.goalsAgainst} 个`,
      met: totals.goalsAgainst <= TACTICS_TARGETS.goalsAgainstMax,
    },
    {
      id: 'wing',
      label: '边路丢球',
      requirement: `≤ ${TACTICS_TARGETS.wingGoalsAgainstMax} 个`,
      actual: `${totals.wingGoalsAgainst} 个`,
      met: totals.wingGoalsAgainst <= TACTICS_TARGETS.wingGoalsAgainstMax,
    },
    {
      id: 'stamina',
      label: '体能消耗',
      requirement: `≤ ${TACTICS_TARGETS.staminaMax}`,
      actual: `${metrics.stamina}`,
      met: metrics.stamina <= TACTICS_TARGETS.staminaMax,
    },
  ];
  const failed = targets.filter((target) => !target.met);
  return { done, passed: done && failed.length === 0, totals, metrics, targets, failed };
}

export interface TacticsComparisonRow {
  label: string;
  fault: string;
  fixed: string;
}

export function buildTacticsComparison(state: TacticsState): TacticsComparisonRow[] {
  const fault = faultTotals(state.fault.played);
  const fixed = verifyTotals(state.verify.results);
  return [
    { label: '创造机会', fault: `${fault.chancesFor} 次`, fixed: `${fixed.chancesFor} 次` },
    { label: '进球', fault: `${fault.goalsFor} 个`, fixed: `${fixed.goalsFor} 个` },
    { label: '被创造机会', fault: `${fault.chancesAgainst} 次`, fixed: `${fixed.chancesAgainst} 次` },
    { label: '失球', fault: `${fault.goalsAgainst} 个`, fixed: `${fixed.goalsAgainst} 个` },
    { label: '边路丢球', fault: `${fault.wingGoalsAgainst} 个`, fixed: `${fixed.wingGoalsAgainst} 个` },
  ];
}

/* ==========================================================================
   阶段指令与对手倾向的对应（界面用于把选择讲清楚）
   ========================================================================== */

export interface InstructionMappingRow {
  instruction: VerifyInstructionId;
  name: string;
  hint: string;
  rightProtection: number;
  centerProtection: number;
  leftProtection: number;
  note: string;
}

export function protectionRiskLabel(value: number): string {
  if (value >= 80) return '稳';
  if (value >= 65) return '可控';
  if (value >= 50) return '吃紧';
  return '危险';
}

export function buildInstructionMapping(state: Pick<TacticsState, 'config' | 'loadout'>): InstructionMappingRow[] {
  const metrics = verificationMetrics(state);
  return VERIFY_INSTRUCTIONS.map((instruction) => {
    const right = sideProtection(metrics, 'right', instruction.id);
    const center = sideProtection(metrics, 'center', instruction.id);
    const left = sideProtection(metrics, 'left', instruction.id);
    let note: string;
    if (instruction.id === 'press-strong') {
      note = `对手 60% 从右路来：压上强侧把右路保护提到 ${right}（${protectionRiskLabel(right)}），但两翼身后会暴露。`;
    } else if (instruction.id === 'cover-wing') {
      note = `右路保护 ${right}、左路 ${left}（${protectionRiskLabel(right)}），中路保护降到 ${center}：先堵最常走的边路。`;
    } else {
      note = `中路保护 ${center}（${protectionRiskLabel(center)}），但右路保护只有 ${right}：对手最常走的右路会变危险。`;
    }
    return {
      instruction: instruction.id,
      name: instruction.name,
      hint: instruction.hint,
      rightProtection: right,
      centerProtection: center,
      leftProtection: left,
      note,
    };
  });
}

/* ==========================================================================
   诊断与迁移题目数据
   ========================================================================== */

export interface QuizOptionData {
  id: string;
  label: string;
  explanation: string;
}

export const DIAGNOSE_CORRECT_ID = 'dual-shape-needed';

export const DIAGNOSE_OPTIONS: QuizOptionData[] = [
  {
    id: DIAGNOSE_CORRECT_ID,
    label: '控球和无球需要两套不同的站位与职责。',
    explanation: '同一名边后卫在控球时要套边提供宽度，丢球后又要保护边路，两个任务落在同一个位置上，必然互相打架。',
  },
  {
    id: 'run-harder',
    label: '球员跑动不够积极，应该要求全队多跑。',
    explanation: '多跑能改变强度，却改变不了站位结构：只有一套 4-4-2，边后卫仍然一个人负责整条边线。',
  },
  {
    id: 'better-fullback',
    label: '对手边路球员太强，换一个更强的边后卫就行。',
    explanation: '换人只是换执行者。只要仍然只有一套站位，新边后卫也会同时被要求套边和回收。',
  },
];

export const TRANSFER_CORRECT_IDS = ['possession-shape', 'out-shape', 'role-duties'];

export const TRANSFER_OPTIONS: QuizOptionData[] = [
  {
    id: 'possession-shape',
    label: '有球形态：控球时球员站在哪里、谁负责拉开宽度。',
    explanation: '有球形态决定推进与创造机会的结构。',
  },
  {
    id: 'out-shape',
    label: '无球形态：丢球后球员退到哪里、谁负责保护边路与中路。',
    explanation: '无球形态决定丢球后的保护结构，和有球形态不是同一套站位。',
  },
  {
    id: 'role-duties',
    label: '职责分工：同一位置在两种阶段承担不同任务，例如边后卫套边或内收。',
    explanation: '职责分工把两套形态落到具体球员的任务上。',
  },
  {
    id: 'star-rating',
    label: '球员总评：总评越高，两种阶段自然都会踢得更好。',
    explanation: '总评是能力，不是结构。它不能告诉球员控球时和丢球后分别站在哪里。',
  },
  {
    id: 'home-atmosphere',
    label: '主场气氛：主场球迷越多，边路就越不容易被打穿。',
    explanation: '气氛能影响强度，但不会自动补上边路的站位空当。',
  },
  {
    id: 'substitution-count',
    label: '换人名额：换人次数越多，越不需要设置两套形态。',
    explanation: '换人只能换执行者，解决不了同一套站位让球员同时承担冲突任务的问题。',
  },
];

/* ==========================================================================
   状态机
   ========================================================================== */

function isPhase(value: unknown): value is LevelPhase {
  return typeof value === 'string' && (PHASE_ORDER as string[]).includes(value);
}

export function requiredStages(state: Pick<TacticsState, 'fastPlay'>): number {
  return state.fastPlay ? 2 : 3;
}

function withEvent(
  state: TacticsState,
  phase: LevelPhase,
  input: { action: string; label: string; before: EventState; after: EventState; delta?: string; note?: string },
): TacticsState {
  return {
    ...state,
    eventLog: recordEvent(state.eventLog, { phase, ...input }),
  };
}

function phaseEventState(state: TacticsState): EventState {
  return { phase: state.phase, stage: state.fault.played.length + state.verify.results.length };
}

export function startFaultPlay(state: TacticsState): TacticsState {
  if (state.phase !== 'commission') return state;
  const next: TacticsState = { ...state, phase: 'faultPlay' };
  return withEvent(next, 'faultPlay', {
    action: 'start-fault-play',
    label: '开始故障试玩：固定一套 4-4-2',
    before: phaseEventState(state),
    after: { phase: 'faultPlay', stage: 0 },
    note: '故障版没有有球/无球之分，三个临场指令只会改变强度，不会改变站位结构。',
  });
}

export function chooseFaultInstruction(state: TacticsState, instruction: FaultInstructionId): TacticsState {
  if (state.phase !== 'faultPlay' || state.fault.done || !isFaultInstruction(instruction)) return state;
  const stages = requiredStages(state);
  const stage = state.fault.played.length + 1;
  if (stage > stages) return state;
  const result = simulateFaultStage(instruction, stage);
  const played = [...state.fault.played, result];
  const done = played.length >= stages;
  const next: TacticsState = {
    ...state,
    fault: { ...state.fault, played, done },
    evidence: done ? { ...state.evidence, experiencedFault: true } : state.evidence,
  };
  return withEvent(next, 'faultPlay', {
    action: 'fault-stage',
    label: `故障版第 ${stage} 阶段：${faultInstructionName(instruction)}`,
    before: { stage: stage - 1, wingChances: stage > 1 ? state.fault.played[stage - 2].opponentWingChances : 0 },
    after: { stage, wingChances: result.opponentWingChances },
    delta: `失球 +${result.goalsAgainst} · 边路被攻入 ${result.opponentWingChances} 次`,
    note: result.note,
  });
}

export function openDiagnose(state: TacticsState): TacticsState {
  if (state.phase !== 'faultPlay' || !state.fault.done) return state;
  const next: TacticsState = { ...state, phase: 'diagnose' };
  return withEvent(next, 'diagnose', {
    action: 'open-diagnose',
    label: '带着比赛记录去诊断',
    before: { phase: 'faultPlay', stages: state.fault.played.length },
    after: { phase: 'diagnose' },
    note: '三个阶段的边路机会都没有下降：问题不在指令，在只有一套站位。',
  });
}

export function resolveDiagnose(state: TacticsState): TacticsState {
  if (state.phase !== 'diagnose' || state.diagnose.resolved) return state;
  const next: TacticsState = { ...state, diagnose: { resolved: true } };
  return withEvent(next, 'diagnose', {
    action: 'diagnose-correct',
    label: '诊断正确：控球和无球需要两套不同的站位与职责',
    before: { resolved: 'false' },
    after: { resolved: 'true' },
    note: '下一步去维修台：可以从 4 个模块里自由安装/卸载，再决定怎么验证。',
  });
}

export function startRepair(state: TacticsState): TacticsState {
  if (state.phase !== 'diagnose' || !state.diagnose.resolved) return state;
  const next: TacticsState = { ...state, phase: 'repair', verify: { ...state.verify, results: [], done: false } };
  return withEvent(next, 'repair', {
    action: 'start-repair',
    label: '开始维修：模块池自由配置',
    before: { phase: 'diagnose' },
    after: { phase: 'repair' },
    note: '两套形态负责站位，职责分工负责任务；不同模块组合会带来不同收益与代价。',
  });
}

/* ---------- 维修台的模块操作（仅 repair 阶段） ---------- */

export function installTacticsModule(state: TacticsState, id: TacticsModuleId): TacticsState {
  if (state.phase !== 'repair') return state;
  if (!TACTICS_MODULES.some((item) => item.id === id)) return state;
  const module = findTacticsModule(id);
  if (state.loadout[module.slot] === id) return state;
  const previous = state.loadout[module.slot];
  const next: TacticsState = { ...state, loadout: { ...state.loadout, [module.slot]: id } };
  return withEvent(next, 'repair', {
    action: `install-module-${id}`,
    label: `安装模块：${module.name}`,
    before: { slot: module.slot, installed: previous ?? '空' },
    after: { slot: module.slot, installed: module.name, effect: module.effect },
    delta: `模块已安装${module.correct ? '' : '（注意副作用）'}`,
    note: module.sideEffect,
  });
}

export function uninstallTacticsModule(state: TacticsState, id: TacticsModuleId): TacticsState {
  if (state.phase !== 'repair') return state;
  const module = findTacticsModule(id);
  if (state.loadout[module.slot] !== id) return state;
  const next: TacticsState = { ...state, loadout: { ...state.loadout, [module.slot]: null } };
  return withEvent(next, 'repair', {
    action: `uninstall-module-${id}`,
    label: `卸载模块：${module.name}`,
    before: { slot: module.slot, installed: module.name },
    after: { slot: module.slot, installed: '空' },
  });
}

export function toggleTacticsModule(state: TacticsState, id: TacticsModuleId): TacticsState {
  if (state.phase !== 'repair') return state;
  const module = findTacticsModule(id);
  return state.loadout[module.slot] === id ? uninstallTacticsModule(state, id) : installTacticsModule(state, id);
}

export function selectPossessionShape(state: TacticsState, shape: PossessionShapeId): TacticsState {
  if (state.phase !== 'repair') return state;
  if (!POSSESSION_SHAPE_OPTIONS.some((item) => item.id === shape)) return state;
  if (state.config.possessionShape === shape) return state;
  const before = verificationMetrics(state);
  const next: TacticsState = { ...state, config: { ...state.config, possessionShape: shape } };
  const after = verificationMetrics(next);
  return withEvent(next, 'repair', {
    action: 'select-possession-shape',
    label: `选择有球形态：${shape}`,
    before: { progression: before.progression, wingProtection: before.wingProtection },
    after: { progression: after.progression, wingProtection: after.wingProtection },
    delta: `推进 ${formatMetricDelta(after.progression - before.progression)}`,
    note: '有球形态负责推进与创造；只有安装「双形态战术」后才会在验证里生效。',
  });
}

export function selectOutShape(state: TacticsState, shape: OutShapeId): TacticsState {
  if (state.phase !== 'repair') return state;
  if (!OUT_SHAPE_OPTIONS.some((item) => item.id === shape)) return state;
  if (state.config.outOfPossessionShape === shape) return state;
  const before = verificationMetrics(state);
  const next: TacticsState = { ...state, config: { ...state.config, outOfPossessionShape: shape } };
  const after = verificationMetrics(next);
  return withEvent(next, 'repair', {
    action: 'select-out-shape',
    label: `选择无球形态：${OUT_SHAPE_OPTIONS.find((item) => item.id === shape)?.name ?? shape}`,
    before: { wingProtection: before.wingProtection, centralProtection: before.centralProtection },
    after: { wingProtection: after.wingProtection, centralProtection: after.centralProtection },
    delta: `边路保护 ${formatMetricDelta(after.wingProtection - before.wingProtection)}`,
    note: '无球形态负责丢球后的保护；只有安装「双形态战术」后才会在验证里生效。',
  });
}

export function selectFullbackDuty(state: TacticsState, duty: FullbackDutyId): TacticsState {
  if (state.phase !== 'repair') return state;
  if (!FULLBACK_DUTY_OPTIONS.some((item) => item.id === duty)) return state;
  if (state.config.fullbackDuty === duty) return state;
  const before = verificationMetrics(state);
  const next: TacticsState = { ...state, config: { ...state.config, fullbackDuty: duty } };
  const after = verificationMetrics(next);
  return withEvent(next, 'repair', {
    action: 'select-fullback-duty',
    label: `选择边后卫职责：${FULLBACK_DUTY_OPTIONS.find((item) => item.id === duty)?.name ?? duty}`,
    before: { progression: before.progression, wingProtection: before.wingProtection },
    after: { progression: after.progression, wingProtection: after.wingProtection },
    delta: `边路保护 ${formatMetricDelta(after.wingProtection - before.wingProtection)}`,
    note: '套边压上提供宽度；内收进入中场保护中路。阵型图会画出对应的跑位。',
  });
}

export function selectPivotDuty(state: TacticsState, duty: PivotDutyId): TacticsState {
  if (state.phase !== 'repair') return state;
  if (!PIVOT_DUTY_OPTIONS.some((item) => item.id === duty)) return state;
  if (state.config.pivotDuty === duty) return state;
  const before = verificationMetrics(state);
  const next: TacticsState = { ...state, config: { ...state.config, pivotDuty: duty } };
  const after = verificationMetrics(next);
  return withEvent(next, 'repair', {
    action: 'select-pivot-duty',
    label: `选择后腰职责：${PIVOT_DUTY_OPTIONS.find((item) => item.id === duty)?.name ?? duty}`,
    before: { centralProtection: before.centralProtection, stamina: before.stamina },
    after: { centralProtection: after.centralProtection, stamina: after.stamina },
    delta: `中路保护 ${formatMetricDelta(after.centralProtection - before.centralProtection)}`,
    note: '双后腰保护更稳，但会少一个前场接应点。阵型图会显示后腰数量。',
  });
}

export function startVerify(state: TacticsState): TacticsState {
  if (state.phase !== 'repair') return state;
  const next: TacticsState = {
    ...state,
    phase: 'verify',
    verify: { results: [], done: false, attempts: state.verify.attempts },
  };
  return withEvent(next, 'verify', {
    action: 'start-verify',
    label: `开始验证：${requiredStages(state)} 个比赛阶段（第 ${state.verify.attempts + 1} 次尝试）`,
    before: { phase: 'repair', modules: loadoutModuleNames(state.loadout).join('、') || '无' },
    after: { phase: 'verify', stages: requiredStages(state) },
    note: '目标会在比赛结束后逐条判定；未达成可以回到维修台重新配置。',
  });
}

export function chooseVerifyInstruction(state: TacticsState, instruction: VerifyInstructionId): TacticsState {
  if (state.phase !== 'verify' || state.verify.done || !isVerifyInstruction(instruction)) return state;
  const stages = requiredStages(state);
  const stage = state.verify.results.length + 1;
  if (stage > stages) return state;
  const metrics = verificationMetrics(state);
  const modifiers = verificationChanceModifiers(state);
  const simulation = simulateVerifyStage(
    { metrics, chanceBonus: modifiers.bonus, chancePenalty: modifiers.penalty },
    instruction,
    stage,
    state.rng,
  );
  const results = [...state.verify.results, simulation.result];
  const done = results.length >= stages;
  const next: TacticsState = {
    ...state,
    rng: simulation.rng,
    verify: { ...state.verify, results, done },
  };
  const verification = done ? evaluateTacticsVerification(next) : null;
  if (verification?.passed) {
    next.evidence = { ...next.evidence, operatedMechanic: true };
  }
  return withEvent(next, 'verify', {
    action: `verify-stage-${stage}`,
    label: `验证第 ${stage} 阶段：${verifyInstructionName(instruction)}`,
    before: { stage: stage - 1, goalsAgainst: state.verify.results.reduce((sum, item) => sum + item.goalsAgainst, 0) },
    after: {
      stage,
      attackSide: attackSideName(simulation.result.attackSide),
      chancesFor: simulation.result.chancesFor,
      goalsAgainst: simulation.result.goalsAgainst,
    },
    delta: `机会 +${simulation.result.chancesFor} · 失球 +${simulation.result.goalsAgainst}`,
    note: simulation.result.note,
  });
}

/** 验证失败后回到维修台：清空本轮成绩，保留故障证据，模块配置保留以便调整；俱乐部扣 €1M 返工成本。 */
export function retryVerification(state: TacticsState): TacticsState {
  if (state.phase !== 'verify' || !state.verify.done) return state;
  const verification = evaluateTacticsVerification(state);
  if (verification.passed) return state;
  const costBefore = remainingBudget(state);
  const next: TacticsState = {
    ...state,
    phase: 'repair',
    failureCount: state.failureCount + 1,
    verify: { results: [], done: false, attempts: state.verify.attempts + 1 },
  };
  const costAfter = remainingBudget(next);
  return withEvent(next, 'repair', {
    action: 'retry-verification',
    label: '验证未达成：回到维修台重新配置',
    before: {
      phase: 'verify',
      chancesFor: verification.totals.chancesFor,
      goalsAgainst: verification.totals.goalsAgainst,
      budget: costBefore,
    },
    after: { phase: 'repair', attempts: next.verify.attempts, budget: costAfter },
    delta: `未达成 ${verification.failed.length} 项目标 · 扣 €${RETRY_COST_MILLIONS}M`,
    note: `未达成：${verification.failed
      .map((target) => `${target.label}（${target.actual}，要求 ${target.requirement}）`)
      .join('；')}。俱乐部承担 €${RETRY_COST_MILLIONS}M 返工成本（修复费用），转会预算 €${formatBudgetM(
      costBefore,
    )}M → €${formatBudgetM(costAfter)}M；本轮验证成绩已清空。`,
  });
}

export function openTransfer(state: TacticsState): TacticsState {
  if (state.phase !== 'verify' || !state.verify.done) return state;
  if (!evaluateTacticsVerification(state).passed) return state;
  const next: TacticsState = { ...state, phase: 'transfer' };
  return withEvent(next, 'transfer', {
    action: 'open-transfer',
    label: '完成验证，去迁移题',
    before: { phase: 'verify' },
    after: { phase: 'transfer' },
    note: '用同一套结构去判断另一支球队的处境。',
  });
}

export function resolveTransfer(state: TacticsState): TacticsState {
  if (state.phase !== 'transfer' || state.transfer.resolved) return state;
  const next: TacticsState = {
    ...state,
    transfer: { ...state.transfer, resolved: true },
    evidence: { ...state.evidence, transferred: true },
  };
  return withEvent(next, 'transfer', {
    action: 'transfer-correct',
    label: '迁移正确：识别出有球形态、无球形态与职责分工',
    before: { resolved: 'false' },
    after: { resolved: 'true' },
    note: '把三样东西一起换到新情境，机制才完整。',
  });
}

/** 展示模式才允许跳过迁移题；跳过后 evidence.transferred 保持 false。 */
export function skipTransferInShowcase(state: TacticsState): TacticsState {
  if (state.mode !== 'showcase' || state.phase !== 'transfer' || state.transfer.resolved) return state;
  const next: TacticsState = {
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

export function openSummary(state: TacticsState): TacticsState {
  if (state.phase !== 'transfer' || !state.transfer.resolved) return state;
  const next: TacticsState = { ...state, phase: 'summary' };
  return withEvent(next, 'summary', {
    action: 'open-summary',
    label: '进入归档',
    before: { phase: 'transfer' },
    after: { phase: 'summary' },
    note: '归档只展示真实做过的操作与真实比赛记录。',
  });
}

export type CompleteBlocker = 'not-summary' | 'already-complete' | 'verify-unmet' | 'transfer-missing' | 'prereq-missing';

/** 归档前逻辑检查：未达成验证目标或未完成迁移时返回具体原因。 */
export function archiveBlocker(state: TacticsState): CompleteBlocker | null {
  if (state.phase !== 'summary') return 'not-summary';
  if (state.completed) return 'already-complete';
  const verification = evaluateTacticsVerification(state);
  if (!verification.passed) return 'verify-unmet';
  if (state.mode !== 'showcase' && (!state.fault.done || !state.diagnose.resolved)) return 'prereq-missing';
  if (state.mode !== 'showcase' && !state.transfer.resolved) return 'transfer-missing';
  return null;
}

export function canComplete(state: TacticsState): boolean {
  return archiveBlocker(state) === null;
}

export function archiveBlockReason(state: TacticsState): string {
  const blocker = archiveBlocker(state);
  if (blocker === 'already-complete') return '已经归档完成，不会重复结算。';
  if (blocker === 'verify-unmet') {
    const failed = evaluateTacticsVerification(state).failed;
    return `验证目标未达成：${failed
      .map((target) => `${target.label}（${target.actual}，要求 ${target.requirement}）`)
      .join('；')}。请回到维修台重新配置。`;
  }
  if (blocker === 'transfer-missing') return '迁移题还没有答对，完成迁移后才能归档。';
  if (blocker === 'prereq-missing') return '还没有完成故障试玩与诊断，不能直接归档。';
  return '还没有完成验证与迁移，暂时不能归档。';
}

export function completeArchive(state: TacticsState): TacticsState {
  if (!canComplete(state)) return state;
  const next: TacticsState = { ...state, completed: true };
  return withEvent(next, 'summary', {
    action: 'archive',
    label: '完成归档：双形态战术与职责分工',
    before: { completed: 'false' },
    after: { completed: 'true', evidence: String(countRealEvidence(state.evidence)) },
    note: '完成记录只包含真实操作；没有最低胜场或净胜球要求。',
  });
}

export function countRealEvidence(evidence: Evidence): number {
  return Number(evidence.experiencedFault) + Number(evidence.operatedMechanic) + Number(evidence.transferred);
}

/** 归档页三条总结：改了哪条规则 / 改变了什么选择 / 产生什么代价。 */
export function buildArchiveSummary(state: TacticsState): string[] {
  const config = state.config;
  const possession = POSSESSION_SHAPE_OPTIONS.find((item) => item.id === config.possessionShape)?.name ?? config.possessionShape;
  const out = OUT_SHAPE_OPTIONS.find((item) => item.id === config.outOfPossessionShape)?.name ?? config.outOfPossessionShape;
  const fullback = FULLBACK_DUTY_OPTIONS.find((item) => item.id === config.fullbackDuty)?.name ?? config.fullbackDuty;
  const pivot = PIVOT_DUTY_OPTIONS.find((item) => item.id === config.pivotDuty)?.name ?? config.pivotDuty;
  const metrics = verificationMetrics(state);
  const verification = evaluateTacticsVerification(state);
  return [
    `改了哪条规则：把「一套 4-4-2 打满全场」改成「有球形态 ${possession} + 无球形态 ${out}」两套站位，并给边后卫与后腰设置职责。`,
    `改变了什么选择：控球时用 ${possession} 推进；丢球后落到 ${out}；边后卫${fullback}、后腰${pivot}，同一名球员在两种阶段做不同的任务。`,
    `产生了什么代价：体能消耗 ${FAULT_METRICS.stamina} → ${metrics.stamina}（目标上限 ${TACTICS_TARGETS.staminaMax}）；最终验证创造机会 ${verification.totals.chancesFor} 次、失球 ${verification.totals.goalsAgainst} 个、边路丢球 ${verification.totals.wingGoalsAgainst} 个。`,
  ];
}

/* ==========================================================================
   俱乐部时间线：只写真实数据
   ========================================================================== */

export function buildClubUpdate(state: TacticsState): ClubUpdate {
  const fault = faultTotals(state.fault.played);
  const fixed = verifyTotals(state.verify.results);
  const metrics = verificationMetrics(state);
  const config = state.config;
  const possession = POSSESSION_SHAPE_OPTIONS.find((item) => item.id === config.possessionShape)?.name ?? config.possessionShape;
  const out = OUT_SHAPE_OPTIONS.find((item) => item.id === config.outOfPossessionShape)?.name ?? config.outOfPossessionShape;
  const fullback = FULLBACK_DUTY_OPTIONS.find((item) => item.id === config.fullbackDuty)?.name ?? config.fullbackDuty;
  const pivot = PIVOT_DUTY_OPTIONS.find((item) => item.id === config.pivotDuty)?.name ?? config.pivotDuty;
  const budget = remainingBudget(state);
  const repairCost = state.failureCount * RETRY_COST_MILLIONS;
  return {
    headline: `战术板上线：边路丢球 ${fault.wingGoalsAgainst} → ${fixed.wingGoalsAgainst}，失球 ${fault.goalsAgainst} → ${fixed.goalsAgainst}`,
    details: [
      `故障版 ${state.fault.played.length} 个阶段：创造 ${fault.chancesFor} 次机会，失 ${fault.goalsAgainst} 球，其中边路丢 ${fault.wingGoalsAgainst} 球。`,
      `修复版 ${state.verify.results.length} 个阶段：有球 ${possession}、无球 ${out}，边后卫${fullback}、后腰${pivot}；创造 ${fixed.chancesFor} 次机会，失 ${fixed.goalsAgainst} 球，其中边路丢 ${fixed.wingGoalsAgainst} 球。`,
      `代价与取舍：体能消耗 ${FAULT_METRICS.stamina} → ${metrics.stamina}（目标上限 ${TACTICS_TARGETS.staminaMax}）；返工 ${state.failureCount} 次，俱乐部承担 €${formatBudgetM(
        repairCost,
      )}M 修复成本，剩余转会预算 €${formatBudgetM(budget)}M。`,
      `验证目标全部达成：机会≥${state.verify.results.length * TACTICS_TARGETS.chancesPerStage}、失球≤${TACTICS_TARGETS.goalsAgainstMax}、边路丢球≤${TACTICS_TARGETS.wingGoalsAgainstMax}、体能≤${TACTICS_TARGETS.staminaMax}。`,
    ],
    nextBrief: '球探室还在用「点一下就看到全部属性」的老办法，首席球探周远需要一套有限球探与知识度报告。',
  };
}

/** 正常模式完成时提交给俱乐部的真实增量；展示模式不写正式进度。 */
export function buildClubPatch(state: TacticsState): ClubPatch | null {
  if (state.mode !== 'normal') return null;
  return {
    tactics: {
      possessionShape: state.config.possessionShape,
      outOfPossessionShape: state.config.outOfPossessionShape,
      fullbackDuty: state.config.fullbackDuty,
      pivotDuty: state.config.pivotDuty,
    },
    transferBudget: remainingBudget(state),
    addFailures: state.failureCount,
  };
}

export function buildCompletionResult(state: TacticsState): {
  evidence: Evidence;
  summary: string[];
  clubUpdate: ClubUpdate;
  clubPatch?: ClubPatch;
} {
  const clubPatch = buildClubPatch(state);
  return {
    evidence: { ...state.evidence },
    summary: buildArchiveSummary(state),
    clubUpdate: buildClubUpdate(state),
    ...(clubPatch ? { clubPatch } : {}),
  };
}

/* ==========================================================================
   初始化、展示模式预填与坏档校验
   ========================================================================== */

function requestedPhase(options: TacticsInitOptions): LevelPhase {
  if (options.mode === 'showcase' && options.showcaseOptions) {
    const phase = options.showcaseOptions.startPhase;
    if (phase === 'commission' || phase === 'faultPlay' || phase === 'diagnose' || phase === 'repair' || phase === 'verify') {
      return phase;
    }
    return 'verify';
  }
  return options.fastStart ? 'faultPlay' : 'commission';
}

function createBaseState(options: TacticsInitOptions, seed: number, phase: LevelPhase): TacticsState {
  const fastPlay = options.mode === 'showcase' && options.showcaseOptions?.fastPlay === true;
  const normalizedSeed = normalizeSeed(seed);
  return {
    version: 3,
    phase,
    mode: options.mode,
    fastPlay,
    seed: normalizedSeed,
    rng: createRng(normalizedSeed),
    config: { ...DEFAULT_TACTICS_CONFIG },
    loadout: { shape: null, attack: null },
    budget: normalizeBudget(options.startingBudget),
    failureCount: 0,
    fault: { played: [], done: false, demoPreloaded: false },
    diagnose: { resolved: false },
    verify: { results: [], done: false, attempts: 0 },
    transfer: { resolved: false, skipped: false },
    evidence: createEvidence(),
    eventLog: [],
    completed: false,
  };
}

/**
 * 创建初始状态。展示模式按 startPhase 预填前置步骤：
 * repair = 诊断完成、模块未装；verify = 两个正确模块已装，可以直接试玩。
 * 预填不会把玩家没做过的步骤写成证据。
 */
export function createInitialTacticsState(options: TacticsInitOptions, seed: number): TacticsState {
  const phase = requestedPhase(options);
  const state = createBaseState(options, seed, phase);
  const stages = state.fastPlay ? 2 : 3;
  const baseline = simulateFaultStages(stages);

  if (phase === 'commission' || phase === 'faultPlay') return state;

  if (phase === 'diagnose') {
    return { ...state, fault: { played: baseline, done: true, demoPreloaded: true } };
  }

  if (phase === 'repair') {
    return {
      ...state,
      fault: { played: baseline, done: true, demoPreloaded: true },
      diagnose: { resolved: true },
    };
  }

  return {
    ...state,
    phase: 'verify',
    fault: { played: baseline, done: true, demoPreloaded: true },
    diagnose: { resolved: true },
    loadout: { shape: 'dual-shape', attack: 'role-duties' },
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

function isConfig(value: unknown): value is TacticsConfig {
  if (!isObject(value)) return false;
  return (
    POSSESSION_SHAPE_OPTIONS.some((item) => item.id === value.possessionShape) &&
    OUT_SHAPE_OPTIONS.some((item) => item.id === value.outOfPossessionShape) &&
    FULLBACK_DUTY_OPTIONS.some((item) => item.id === value.fullbackDuty) &&
    PIVOT_DUTY_OPTIONS.some((item) => item.id === value.pivotDuty)
  );
}

function isLoadout(value: unknown): value is TacticsLoadout {
  if (!isObject(value)) return false;
  const shape = value.shape;
  const attack = value.attack;
  const shapeOk = shape === null || shape === 'dual-shape' || shape === 'man-marking';
  const attackOk = attack === null || attack === 'role-duties' || attack === 'long-ball';
  return shapeOk && attackOk;
}

function isFaultStageResult(value: unknown): value is FaultStageResult {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.stage) &&
    value.stage >= 1 &&
    isFaultInstruction(value.instruction) &&
    isFiniteNumber(value.ourChances) &&
    isFiniteNumber(value.opponentChances) &&
    isFiniteNumber(value.opponentWingChances) &&
    isFiniteNumber(value.goalsAgainst) &&
    isFiniteNumber(value.wingGoalsAgainst) &&
    typeof value.note === 'string'
  );
}

function isVerifyStageResult(value: unknown): value is VerifyStageResult {
  if (!isObject(value)) return false;
  const side = value.attackSide;
  return (
    isFiniteNumber(value.stage) &&
    value.stage >= 1 &&
    isVerifyInstruction(value.instruction) &&
    (side === 'right' || side === 'center' || side === 'left') &&
    isFiniteNumber(value.chancesFor) &&
    isFiniteNumber(value.goalsFor) &&
    isFiniteNumber(value.chancesAgainst) &&
    isFiniteNumber(value.goalsAgainst) &&
    isFiniteNumber(value.wingGoalsAgainst) &&
    isFiniteNumber(value.protection) &&
    typeof value.note === 'string'
  );
}

function isEvidenceShape(value: unknown): value is Evidence {
  if (!isObject(value)) return false;
  return isBoolean(value.experiencedFault) && isBoolean(value.operatedMechanic) && isBoolean(value.transferred);
}

/**
 * 校验并恢复存档（只接受 v3 结构；旧版存档安全回退）。
 * 存档里的 mode / fastPlay 必须与当前上下文一致。
 */
export function reviveTacticsState(raw: unknown, options: TacticsInitOptions): TacticsState | null {
  if (!isObject(raw)) return null;
  if (raw.version !== 3) return null;
  if (!isPhase(raw.phase)) return null;
  const mode = raw.mode;
  if (mode !== 'normal' && mode !== 'showcase') return null;
  if (mode !== options.mode) return null;
  if (!isBoolean(raw.fastPlay)) return null;
  const expectedFastPlay = options.mode === 'showcase' && options.showcaseOptions?.fastPlay === true;
  if (raw.fastPlay !== expectedFastPlay) return null;
  if (!isFiniteNumber(raw.seed) || !isRngState(raw.rng)) return null;
  if (!isConfig(raw.config)) return null;
  if (!isLoadout(raw.loadout)) return null;
  if (!isFiniteNumber(raw.budget) || raw.budget < 0) return null;
  if (!isFiniteNumber(raw.failureCount) || raw.failureCount < 0) return null;
  const fault = raw.fault;
  if (!isObject(fault) || !Array.isArray(fault.played) || !fault.played.every(isFaultStageResult)) return null;
  if (!isBoolean(fault.done) || !isBoolean(fault.demoPreloaded)) return null;
  const diagnose = raw.diagnose;
  if (!isObject(diagnose) || !isBoolean(diagnose.resolved)) return null;
  const verify = raw.verify;
  if (!isObject(verify) || !Array.isArray(verify.results) || !verify.results.every(isVerifyStageResult)) return null;
  if (!isBoolean(verify.done) || !isFiniteNumber(verify.attempts) || verify.attempts < 0) return null;
  const transfer = raw.transfer;
  if (!isObject(transfer) || !isBoolean(transfer.resolved) || !isBoolean(transfer.skipped)) return null;
  if (!isEvidenceShape(raw.evidence)) return null;
  if (!isValidEventLog(raw.eventLog)) return null;
  if (!isBoolean(raw.completed)) return null;

  const stageLimit = raw.fastPlay ? 2 : 3;
  if (fault.played.length > stageLimit) return null;
  if (verify.results.length > stageLimit) return null;
  if (verify.done && verify.results.length !== stageLimit) return null;
  if (raw.phase === 'repair' && verify.results.length > 0) return null;
  if (raw.phase === 'commission' && fault.played.length > 0) return null;
  if ((raw.phase === 'transfer' || raw.phase === 'summary') && !verify.done) return null;
  if (raw.phase === 'summary' && raw.mode === 'normal' && !transfer.resolved) return null;

  return {
    version: 3,
    phase: raw.phase,
    mode,
    fastPlay: raw.fastPlay,
    seed: normalizeSeed(raw.seed),
    rng: reviveRng(raw.rng),
    config: { ...(raw.config as TacticsConfig) },
    loadout: { shape: (raw.loadout as TacticsLoadout).shape, attack: (raw.loadout as TacticsLoadout).attack },
    budget: normalizeBudget(raw.budget),
    failureCount: Math.floor(raw.failureCount),
    fault: {
      played: [...(fault.played as FaultStageResult[])],
      done: fault.done,
      demoPreloaded: fault.demoPreloaded,
    },
    diagnose: { resolved: diagnose.resolved },
    verify: {
      results: [...(verify.results as VerifyStageResult[])],
      done: verify.done,
      attempts: Math.floor(verify.attempts),
    },
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

/** 界面用：某阵型/职责的指标摘要文字。 */
export function metricsSummary(metrics: TacticsMetrics): string {
  return `推进 ${metrics.progression} · 边路保护 ${metrics.wingProtection} · 中路保护 ${metrics.centralProtection} · 体能 ${metrics.stamina}`;
}
