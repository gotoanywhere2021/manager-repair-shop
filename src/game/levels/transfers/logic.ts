/**
 * 关卡三《转会窗》的纯规则层。
 *
 * 这一层不依赖 React / DOM：
 * - 所有状态都可 JSON 序列化（phase / rng / eventLog / 预算 / 球员 / 模块 / evidence）；
 * - 所有状态变化都是纯函数，非法操作返回 ok: false 与中文原因，不修改原状态；
 * - 随机只用 shared 的 mulberry32（engine/rng.ts），相同种子 + 相同动作序列结果一致。
 *
 * 本关的学习系统是「转会谈判」：
 * 故障版里报价没有成本、预算无限，签谁都不构成选择；
 * 修复版把转会预算、周薪空间、报价档位、等待与竞争对手兴趣同时装上，
 * 让每一次报价都变成「现在锁定」与「再等一轮」之间的权衡。
 */

import { createRng, isRngState, nextInt, reviveRng } from '../../engine/rng';
import type { RngState } from '../../engine/rng';
import { recordEvent } from '../../engine/events';
import { createEvidence } from '../../engine/types';
import type {
  EventLogEntry,
  EventState,
  Evidence,
  GameMode,
  LevelPhase,
  QuizOption,
  ShowcaseOptions,
} from '../../engine/types';
import { buildComparisonRows } from '../../engine/events';
import type { ComparisonRow } from '../../engine/events';

/* ==========================================================================
   常量：所有数值都写在这里，测试与界面共用同一份来源。
   ========================================================================== */

/** 转会预算：单位「万欧」，4500 万欧 = €45M。 */
export const TRANSFER_BUDGET = 4500;
/** 周薪空间：单位「千欧/周」，350 千欧 = €350k/周。 */
export const TRANSFER_WAGE_SPACE = 350;
/** 正常模式的转会窗口轮数。 */
export const TRANSFER_ROUNDS = 3;
/** 展示短局的转会窗口轮数。 */
export const TRANSFER_ROUNDS_FAST = 2;
/** 正常模式至少签下的人数。 */
export const TRANSFER_REQUIRED_SIGNINGS = 2;
/** 展示短局至少签下的人数。 */
export const TRANSFER_REQUIRED_SIGNINGS_FAST = 1;
/** 竞争对手兴趣达到这个数值，目标被截胡并永久失去。 */
export const RIVAL_HIJACK_AT = 100;
/** 每轮结束，所有未签约目标的兴趣增量。 */
export const RIVAL_ROUND_DRIFT = 10;
/** 低价报价让竞争对手兴趣上升的数值。 */
export const RIVAL_LOW_OFFER = 30;
/** 等待一轮让竞争对手兴趣上升的数值。 */
export const RIVAL_WAIT = 20;
/** 高价报价让竞争对手兴趣上升的数值。 */
export const RIVAL_HIGH_OFFER = 5;
/** 低价报价成功时，实际只需要支付要价的这个比例。 */
export const LOW_OFFER_RATIO = 0.9;
/** 高价报价需要支付要价的这个比例。 */
export const HIGH_OFFER_RATIO = 1.1;
/** 等待一轮且还没到最后一轮时，要价下降的比例。 */
export const WAIT_PRICE_CUT = 0.1;
/** 低价报价在兴趣低于此值时才能签下。 */
export const LOW_OFFER_MAX_INTEREST = 50;
/** 正常报价在兴趣低于此值时才能签下。 */
export const NORMAL_OFFER_MAX_INTEREST = 80;
/** 等待后要价的最低值，避免把身价砍到不合理的数字。 */
export const MIN_ASKING_PRICE = 200;

/** 故障版候选只显示身价，不显示工资/佣金，也没有竞争。 */
export interface PlayerSeed {
  id: string;
  name: string;
  position: string;
  valuation: number;
  wage: number;
  agentFee: number;
  baseInterest: number;
}

/** 三名候选全部为虚构球员。 */
export const PLAYER_SEEDS: PlayerSeed[] = [
  { id: 'jiang-ye', name: '江野', position: '边锋', valuation: 2200, wage: 160, agentFee: 80, baseInterest: 34 },
  { id: 'mula-ti', name: '木拉提', position: '中卫', valuation: 1600, wage: 120, agentFee: 50, baseInterest: 28 },
  { id: 'chen-yan', name: '陈砚', position: '门将', valuation: 1100, wage: 90, agentFee: 40, baseInterest: 18 },
];

/* ==========================================================================
   类型
   ========================================================================== */

export type TransferTier = 'low' | 'normal' | 'high';

export type TransferModules = {
  budget: boolean;
  negotiation: boolean;
};

export type TransferModuleId = keyof TransferModules;

export interface TransferPlayer {
  id: string;
  name: string;
  position: string;
  /** 初始身价 / 当前要价，单位万欧。 */
  valuation: number;
  askingPrice: number;
  /** 周薪，单位千欧。 */
  wage: number;
  /** 经纪人佣金，签约时与转会费一起从预算扣除，单位万欧。 */
  agentFee: number;
  /** 竞争对手兴趣 0~100。 */
  rivalInterest: number;
  status: 'available' | 'signed' | 'lost';
  signedRound: number | null;
  lostRound: number | null;
}

export interface TransfersState {
  version: 1;
  phase: LevelPhase;
  mode: GameMode;
  fastPlay: boolean;
  seed: number;
  rng: RngState;
  eventLog: EventLogEntry[];
  evidence: Evidence;
  modules: TransferModules;
  /** 故障试玩里点「直接签下」的球员。 */
  faultSigned: string[];
  /** 是否已经结束故障试玩。 */
  faultFinished: boolean;
  /** 诊断题是否已经答对。 */
  diagnoseResolved: boolean;
  /** 当前转会窗口轮次，从 1 开始。 */
  round: number;
  windowStarted: boolean;
  windowClosed: boolean;
  /** 本轮窗口里已经做出的动作数。 */
  actionsTaken: number;
  /** 剩余转会预算，单位万欧。 */
  budget: number;
  /** 剩余周薪空间，单位千欧/周。 */
  wage: number;
  players: TransferPlayer[];
  transferResolved: boolean;
  transferSkipped: boolean;
}

export interface TransferActionResult {
  state: TransfersState;
  ok: boolean;
  reason?: string;
}

export interface OfferCheck {
  ok: boolean;
  reason?: string;
  fee: number;
  totalCost: number;
}

export interface CreateTransfersOptions {
  mode: GameMode;
  seed: number;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
}

/* ==========================================================================
   诊断题与迁移题：题目数据放在规则层，界面只负责渲染。
   ========================================================================== */

export const DIAGNOSE_OPTIONS: QuizOption[] = [
  { id: 'costs', label: '签约缺少预算、工资空间与竞争风险等代价。' },
  { id: 'price', label: '球员身价太低，签下他们没有任何挑战。' },
  { id: 'buttons', label: '报价按钮太少，点起来不够爽快。' },
  { id: 'no-rival', label: '因为没有竞争对手，所以谈判永远不会失败。' },
];

export const DIAGNOSE_CORRECT_ID = 'costs';

export const DIAGNOSE_EXPLANATIONS: Record<string, string> = {
  costs: '故障版里报价只是一次点击：没有预算上限、没有周薪空间、没有竞争对手，也没有窗口关闭。所以「签谁」根本不构成选择。',
  price: '身价高低不是问题。真正的问题是：无论身价多少，签下它都不需要付出任何代价。',
  buttons: '按钮数量不是机制问题。修复版不是增加按钮，而是给每次点击加上预算、工资与竞争这三层代价。',
  'no-rival': '故障版确实没有竞争对手，但「没有竞争」正是问题的一部分。修复版会把竞争兴趣加回来，让等待有风险。',
};

export const TRANSFER_QUIZ_OPTIONS: QuizOption[] = [
  {
    id: 'all-four',
    label:
      '预算和工资空间决定「签不签得起」，竞争兴趣与剩余轮次决定「还来不来得及签」；四个要素同时约束一次报价。',
  },
  {
    id: 'budget-only',
    label: '只要转会预算够，报价就一定能成功；工资空间与竞争兴趣只影响界面提示。',
  },
  {
    id: 'wait-free',
    label: '等待没有成本：等得越久要价越低，竞争对手兴趣会自动下降。',
  },
  {
    id: 'rich-ok',
    label: '把预算全部花在第一名球员身上最划算，因为好球员越多越好。',
  },
];

export const TRANSFER_QUIZ_CORRECT_ID = 'all-four';

export const TRANSFER_QUIZ_EXPLANATIONS: Record<string, string> = {
  'all-four':
    '正确：一次报价同时受四个要素约束——转会预算、周薪空间、竞争对手兴趣、窗口剩余轮次。它们一起把「点按钮」变成「现在锁定还是再等一轮」。',
  'budget-only':
    '预算只是一个上限：工资空间不够、竞争对手兴趣过高、或者窗口已经关闭，都会让预算充足的报价落空。',
  'wait-free':
    '等待会抬高竞争对手兴趣，而且要价下降只发生在窗口还没结束的轮次。等得越久，越可能直接等到「被截胡」。',
  'rich-ok':
    '把预算集中在一个人身上会挤掉其他位置的工资空间，也可能错过窗口。签下多少人不重要，能不能补上缺口才重要。',
};

/* ==========================================================================
   小工具
   ========================================================================== */

const PHASE_LIST: LevelPhase[] = ['commission', 'faultPlay', 'diagnose', 'repair', 'verify', 'transfer', 'summary'];

function isPhase(value: unknown): value is LevelPhase {
  return typeof value === 'string' && (PHASE_LIST as string[]).includes(value);
}

/** 把「万欧」格式化成 €45M / €9.5M 这样的展示文本。 */
export function formatFee(wan: number): string {
  const millions = wan / 100;
  const text = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
  return `€${text}M`;
}

/** 把「千欧/周」格式化成 €160k/周。 */
export function formatWage(kilo: number): string {
  return `€${kilo}k/周`;
}

/** 正常 / 短局窗口轮数。 */
export function roundLimit(state: TransfersState): number {
  return state.fastPlay ? TRANSFER_ROUNDS_FAST : TRANSFER_ROUNDS;
}

/** 正常 / 短局要求签下的人数。 */
export function requiredSignings(state: TransfersState): number {
  return state.fastPlay ? TRANSFER_REQUIRED_SIGNINGS_FAST : TRANSFER_REQUIRED_SIGNINGS;
}

export function signedPlayers(state: TransfersState): TransferPlayer[] {
  return state.players.filter((player) => player.status === 'signed');
}

export function signedCount(state: TransfersState): number {
  return signedPlayers(state).length;
}

/** 是否达到「至少签下 N 人」的完成条件。 */
export function isGoalMet(state: TransfersState): boolean {
  return signedCount(state) >= requiredSignings(state);
}

/** 报价档位对应的中文名称。 */
export function tierName(tier: TransferTier): string {
  if (tier === 'low') return '低价报价';
  if (tier === 'high') return '高价报价';
  return '正常报价';
}

/** 某一档报价在当前要价下的费用（不含经纪人佣金）。 */
export function tierFee(player: TransferPlayer, tier: TransferTier): number {
  if (tier === 'low') return Math.round(player.askingPrice * LOW_OFFER_RATIO);
  if (tier === 'high') return Math.round(player.askingPrice * HIGH_OFFER_RATIO);
  return player.askingPrice;
}

/** 这一档报价在当前状态下是否被允许，以及需要花多少钱。 */
export function canOffer(state: TransfersState, playerId: string, tier: TransferTier): OfferCheck {
  const player = state.players.find((item) => item.id === playerId);
  const fee = player ? tierFee(player, tier) : 0;
  const totalCost = player ? fee + player.agentFee : 0;
  if (state.phase !== 'verify') return { ok: false, reason: '现在不在转会窗口阶段。', fee, totalCost };
  if (!state.windowStarted) return { ok: false, reason: '转会窗口还没有开始。', fee, totalCost };
  if (state.windowClosed) return { ok: false, reason: '转会窗口已经关闭。', fee, totalCost };
  if (!state.modules.budget || !state.modules.negotiation) {
    return { ok: false, reason: '预算与谈判模块没有全部安装，报价规则未启用。', fee, totalCost };
  }
  if (!player) return { ok: false, reason: '找不到这名候选。', fee, totalCost };
  if (player.status === 'signed') return { ok: false, reason: `${player.name} 已经签约。`, fee, totalCost };
  if (player.status === 'lost') return { ok: false, reason: `${player.name} 已经被竞争对手截胡。`, fee, totalCost };
  if (tier !== 'low' && tier !== 'normal' && tier !== 'high') {
    return { ok: false, reason: '报价档位无效。', fee, totalCost };
  }
  if (state.round > roundLimit(state)) return { ok: false, reason: '转会窗口已经结束。', fee, totalCost };
  if (totalCost > state.budget) {
    return {
      ok: false,
      reason: `转会预算不足：这次签约需要 ${formatFee(totalCost)}（含佣金 ${formatFee(player.agentFee)}），剩余预算 ${formatFee(state.budget)}。`,
      fee,
      totalCost,
    };
  }
  if (player.wage > state.wage) {
    return {
      ok: false,
      reason: `工资空间不足：需要 ${formatWage(player.wage)}，剩余 ${formatWage(state.wage)}。`,
      fee,
      totalCost,
    };
  }
  return { ok: true, fee, totalCost };
}

function snapshot(state: TransfersState, extra: EventState = {}): EventState {
  return {
    round: state.round,
    budget: state.budget,
    wage: state.wage,
    signed: signedCount(state),
    ...extra,
  };
}

function log(state: TransfersState, input: Parameters<typeof recordEvent>[1]): TransfersState {
  return { ...state, eventLog: recordEvent(state.eventLog, input) };
}

function createPlayers(rng: RngState): { players: TransferPlayer[]; rng: RngState } {
  let current = rng;
  const players = PLAYER_SEEDS.map((seed) => {
    const draw = nextInt(current, 10);
    current = draw.rng;
    return {
      id: seed.id,
      name: seed.name,
      position: seed.position,
      valuation: seed.valuation,
      askingPrice: seed.valuation,
      wage: seed.wage,
      agentFee: seed.agentFee,
      rivalInterest: seed.baseInterest + draw.value,
      status: 'available' as const,
      signedRound: null,
      lostRound: null,
    };
  });
  return { players, rng: current };
}

/* ==========================================================================
   初始状态
   ========================================================================== */

export function createTransfersState(options: CreateTransfersOptions): TransfersState {
  const summon = createPlayers(createRng(options.seed));
  const showcase = options.showcaseOptions;
  let phase: LevelPhase = options.fastStart ? 'faultPlay' : 'commission';
  let modules: TransferModules = { budget: false, negotiation: false };
  let windowStarted = false;

  if (showcase) {
    if (showcase.startPhase === 'faultPlay') {
      phase = 'faultPlay';
    } else if (showcase.startPhase === 'repair') {
      phase = 'repair';
    } else if (showcase.startPhase === 'verify') {
      phase = 'verify';
      modules = { budget: true, negotiation: true };
      windowStarted = true;
    } else {
      phase = 'commission';
    }
  }

  return {
    version: 1,
    phase,
    mode: options.mode,
    fastPlay: showcase?.fastPlay ?? false,
    seed: options.seed,
    rng: summon.rng,
    eventLog: [],
    evidence: createEvidence(),
    modules,
    faultSigned: [],
    faultFinished: false,
    diagnoseResolved: false,
    round: 1,
    windowStarted,
    windowClosed: false,
    actionsTaken: 0,
    budget: TRANSFER_BUDGET,
    wage: TRANSFER_WAGE_SPACE,
    players: summon.players,
    transferResolved: false,
    transferSkipped: false,
  };
}

/** 供展示模式 / 测试直接拿到窗口内的状态。 */
export function readyWindowState(seed: number, fastPlay = false): TransfersState {
  const initial = createTransfersState({
    mode: 'normal',
    seed,
    fastStart: true,
    showcaseOptions: null,
  });
  return {
    ...initial,
    phase: 'verify',
    modules: { budget: true, negotiation: true },
    faultSigned: ['jiang-ye'],
    faultFinished: true,
    diagnoseResolved: true,
    windowStarted: true,
    evidence: { ...initial.evidence, experiencedFault: true },
    fastPlay,
  };
}

/* ==========================================================================
   故障试玩
   ========================================================================== */

export function startFaultPlay(state: TransfersState): TransferActionResult {
  if (state.phase !== 'commission') return { state, ok: false, reason: '现在不在接单阶段。' };
  const next = log(
    { ...state, phase: 'faultPlay' },
    {
      phase: 'faultPlay',
      action: 'start-fault',
      label: '开始故障试玩：旧版转会窗',
      before: { phase: state.phase },
      after: { phase: 'faultPlay' },
      note: '旧版没有预算、工资空间与竞争，点一下就能签下任何候选。',
    },
  );
  return { state: next, ok: true };
}

export function directSign(state: TransfersState, playerId: string): TransferActionResult {
  if (state.phase !== 'faultPlay') return { state, ok: false, reason: '现在不在故障试玩阶段。' };
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return { state, ok: false, reason: '找不到这名候选。' };
  if (state.faultSigned.includes(playerId)) return { state, ok: false, reason: `${player.name} 在故障版里已经签下。` };
  const next = log(
    { ...state, faultSigned: [...state.faultSigned, playerId] },
    {
      phase: 'faultPlay',
      action: 'fault-sign',
      label: `故障版直接签下：${player.name}（身价 ${formatFee(player.valuation)}）`,
      before: { signed: state.faultSigned.length },
      after: { signed: state.faultSigned.length + 1 },
      delta: `+${player.name}`,
      note: '没有扣预算、没有占工资空间、没有竞争对手出价。',
    },
  );
  return { state: next, ok: true };
}

export function finishFaultPlay(state: TransfersState): TransferActionResult {
  if (state.phase !== 'faultPlay') return { state, ok: false, reason: '现在不在故障试玩阶段。' };
  if (state.faultSigned.length === 0) {
    return { state, ok: false, reason: '至少先用「直接签下」体验一次没有代价的报价。' };
  }
  const next = log(
    {
      ...state,
      phase: 'diagnose',
      faultFinished: true,
      evidence: { ...state.evidence, experiencedFault: true },
    },
    {
      phase: 'diagnose',
      action: 'finish-fault',
      label: `结束故障试玩：签下 ${state.faultSigned.length} 人，没有任何代价`,
      before: { signed: state.faultSigned.length },
      after: { phase: 'diagnose' },
      note: '没有预算、工资空间与竞争，报价只是点击按钮。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   诊断与维修
   ========================================================================== */

export function resolveDiagnosis(state: TransfersState): TransferActionResult {
  if (state.phase !== 'diagnose') return { state, ok: false, reason: '现在不在诊断阶段。' };
  const next = log(
    { ...state, phase: 'repair', diagnoseResolved: true },
    {
      phase: 'repair',
      action: 'diagnose-correct',
      label: '诊断正确：报价缺少预算、工资与竞争代价',
      before: { phase: 'diagnose' },
      after: { phase: 'repair' },
      note: '接下来安装「预算与工资空间」与「报价与谈判」两个模块。',
    },
  );
  return { state: next, ok: true };
}

export function setModule(state: TransfersState, moduleId: TransferModuleId, installed: boolean): TransferActionResult {
  if (state.phase !== 'repair') return { state, ok: false, reason: '只有在维修阶段可以安装模块。' };
  if (state.windowStarted) return { state, ok: false, reason: '转会窗口已经开始，模块已锁定。' };
  if (moduleId !== 'budget' && moduleId !== 'negotiation') return { state, ok: false, reason: '未知模块。' };
  const label = moduleId === 'budget' ? '预算与工资空间' : '报价与谈判';
  const next = log(
    { ...state, modules: { ...state.modules, [moduleId]: installed } },
    {
      phase: 'repair',
      action: 'module',
      label: `${installed ? '安装' : '卸载'}模块：${label}`,
      before: { modules: state.modules.budget ? 'budget+negotiation' : 'partial' },
      after: { modules: installed ? 'installed' : 'uninstalled' },
      note: installed ? '规则已启用。' : '规则已退化，相关代价不再生效。',
    },
  );
  return { state: next, ok: true };
}

export function startWindow(state: TransfersState): TransferActionResult {
  if (state.phase !== 'repair') return { state, ok: false, reason: '现在不在维修阶段。' };
  if (state.windowStarted) return { state, ok: false, reason: '转会窗口已经开始。' };
  if (!state.modules.budget || !state.modules.negotiation) {
    return { state, ok: false, reason: '需要同时安装「预算与工资空间」和「报价与谈判」才能开始窗口。' };
  }
  const next = log(
    { ...state, phase: 'verify', windowStarted: true, round: 1, windowClosed: false, actionsTaken: 0 },
    {
      phase: 'verify',
      action: 'window-open',
      label: `开始 ${roundLimit(state)} 轮转会窗口`,
      before: { round: 0, budget: state.budget, wage: state.wage },
      after: { round: 1, budget: state.budget, wage: state.wage },
      note: `每轮只能对 1 名目标报价或等待；至少签下 ${requiredSignings(state)} 人。`,
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   窗口内动作
   ========================================================================== */

export function canWaitTarget(state: TransfersState, playerId: string): { ok: boolean; reason?: string } {
  if (state.phase !== 'verify') return { ok: false, reason: '现在不在转会窗口阶段。' };
  if (!state.windowStarted) return { ok: false, reason: '转会窗口还没有开始。' };
  if (state.windowClosed) return { ok: false, reason: '转会窗口已经关闭。' };
  if (!state.modules.negotiation) return { ok: false, reason: '报价与谈判模块未安装，等待规则未启用。' };
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return { ok: false, reason: '找不到这名候选。' };
  if (player.status === 'signed') return { ok: false, reason: `${player.name} 已经签约。` };
  if (player.status === 'lost') return { ok: false, reason: `${player.name} 已经被竞争对手截胡。` };
  return { ok: true };
}

function endRound(state: TransfersState): TransfersState {
  if (!state.windowStarted || state.windowClosed) return state;
  let next = state;
  const nextRound = state.round + 1;

  next.players.forEach((player) => {
    if (player.status !== 'available') return;
    const beforeInterest = player.rivalInterest;
    const interest = beforeInterest + RIVAL_ROUND_DRIFT;
    if (interest >= RIVAL_HIJACK_AT) {
      next = {
        ...next,
        players: next.players.map((item) =>
          item.id === player.id ? { ...item, rivalInterest: RIVAL_HIJACK_AT, status: 'lost', lostRound: nextRound } : item,
        ),
      };
      next = log(next, {
        phase: 'verify',
        action: 'hijack',
        label: `${player.name} 被竞争对手截胡（兴趣 ${beforeInterest} → ${RIVAL_HIJACK_AT}）`,
        before: { interest: beforeInterest },
        after: { interest: RIVAL_HIJACK_AT },
        note: `第 ${nextRound} 轮结束时兴趣达到 ${RIVAL_HIJACK_AT}，这名目标永久失去。`,
      });
    } else {
      next = {
        ...next,
        players: next.players.map((item) =>
          item.id === player.id ? { ...item, rivalInterest: interest } : item,
        ),
      };
    }
  });

  const round = nextRound;
  const limit = roundLimit(state);
  const closed = round > limit;
  next = {
    ...next,
    round: Math.min(round, limit + 1),
    windowClosed: closed,
    evidence: closed && state.actionsTaken >= 1 ? { ...state.evidence, operatedMechanic: true } : next.evidence,
  };

  if (closed) {
    next = log(next, {
      phase: 'verify',
      action: 'window-close',
      label: `转会窗口关闭：已签下 ${signedCount(next)} / ${requiredSignings(next)} 人`,
      before: { round: limit, budget: next.budget, wage: next.wage },
      after: { round: next.round, budget: next.budget, wage: next.wage, signed: signedCount(next) },
      note: `剩余预算 ${formatFee(next.budget)}，剩余工资空间 ${formatWage(next.wage)}。`,
    });
  }
  return next;
}

function applyOffer(state: TransfersState, playerId: string, tier: TransferTier): TransferActionResult {
  const check = canOffer(state, playerId, tier);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return { state, ok: false, reason: '找不到这名候选。' };

  const beforeInterest = player.rivalInterest;
  const success =
    tier === 'high'
      ? true
      : tier === 'low'
        ? beforeInterest < LOW_OFFER_MAX_INTEREST
        : beforeInterest < NORMAL_OFFER_MAX_INTEREST;
  const interestGain = tier === 'low' ? RIVAL_LOW_OFFER : tier === 'high' ? RIVAL_HIGH_OFFER : 15;
  const afterInterest = Math.min(RIVAL_HIJACK_AT, beforeInterest + interestGain);

  const players = state.players.map((item) => {
    if (item.id !== player.id) return item;
    if (success) {
      return { ...item, status: 'signed' as const, signedRound: state.round, rivalInterest: beforeInterest };
    }
    return { ...item, rivalInterest: afterInterest };
  });

  const nextBudget = success ? state.budget - check.totalCost : state.budget;
  const nextWage = success ? state.wage - player.wage : state.wage;
  const signedNow = signedCount({ ...state, players });

  let next: TransfersState = {
    ...state,
    players,
    budget: nextBudget,
    wage: nextWage,
    actionsTaken: state.actionsTaken + 1,
  };

  const failReason =
    tier === 'low'
      ? `竞争对手兴趣 ${beforeInterest} ≥ ${LOW_OFFER_MAX_INTEREST}，低价报价被拒绝。`
      : tier === 'normal'
        ? `竞争对手兴趣 ${beforeInterest} ≥ ${NORMAL_OFFER_MAX_INTEREST}，正常报价被拒绝。`
        : '';

  next = log(next, {
    phase: 'verify',
    action: tier === 'low' ? 'offer-low' : tier === 'high' ? 'offer-high' : 'offer-normal',
    label: success
      ? `第 ${state.round} 轮 · ${tierName(tier)} · ${player.name} 签约成功（${formatFee(check.fee)} + 佣金 ${formatFee(player.agentFee)}）`
      : `第 ${state.round} 轮 · ${tierName(tier)} · ${player.name} 报价失败`,
    before: snapshot(state, { interest: beforeInterest }),
    after: {
      round: Math.min(state.round + 1, roundLimit(state) + 1),
      budget: nextBudget,
      wage: nextWage,
      signed: signedNow,
      interest: success ? beforeInterest : afterInterest,
    },
    delta: success
      ? `-${formatFee(check.totalCost)} / -${formatWage(player.wage)}`
      : `兴趣 +${interestGain}`,
    note: success
      ? tier === 'low'
        ? `低价报价按要价九折成交，但竞争对手兴趣也上升到 ${afterInterest}（如果还有下一轮）。`
        : tier === 'high'
          ? '高价报价保证成交，但多付了 10% 的转会费。'
          : '正常报价按当前要价成交。'
      : failReason,
  });

  return { state: endRound(next), ok: true };
}

export function offer(state: TransfersState, playerId: string, tier: TransferTier): TransferActionResult {
  const result = applyOffer(state, playerId, tier);
  if (!result.ok) return result;
  return { state: result.state, ok: true };
}

/** 兼容更直白的调用名。 */
export const makeOffer = offer;

export function waitTarget(state: TransfersState, playerId: string): TransferActionResult {
  const check = canWaitTarget(state, playerId);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return { state, ok: false, reason: '找不到这名候选。' };

  const beforeInterest = player.rivalInterest;
  const canCut = state.round < roundLimit(state);
  const nextAsking = canCut
    ? Math.max(MIN_ASKING_PRICE, Math.round(player.askingPrice * (1 - WAIT_PRICE_CUT)))
    : player.askingPrice;
  const afterInterest = Math.min(RIVAL_HIJACK_AT, beforeInterest + RIVAL_WAIT);

  let next: TransfersState = {
    ...state,
    players: state.players.map((item) =>
      item.id === player.id
        ? { ...item, rivalInterest: afterInterest, askingPrice: nextAsking }
        : item,
    ),
    actionsTaken: state.actionsTaken + 1,
  };

  next = log(next, {
    phase: 'verify',
    action: 'wait',
    label: `第 ${state.round} 轮 · 等待 · ${player.name}（要价 ${formatFee(player.askingPrice)} → ${formatFee(nextAsking)}）`,
    before: snapshot(state, { interest: beforeInterest, asking: player.askingPrice }),
    after: {
      round: Math.min(state.round + 1, roundLimit(state) + 1),
      budget: next.budget,
      wage: next.wage,
      signed: signedCount(next),
      interest: afterInterest,
      asking: nextAsking,
    },
    delta: `兴趣 +${afterInterest - beforeInterest}`,
    note: canCut
      ? `等待让要价下降 10%，但竞争对手兴趣 +${RIVAL_WAIT}；本目标的兴趣会在轮末继续 +${RIVAL_ROUND_DRIFT}。`
      : '这是最后一轮，等待不会让要价再下降，窗口即将关闭。',
  });

  return { state: endRound(next), ok: true };
}

export function closeWindow(state: TransfersState): TransferActionResult {
  if (state.phase !== 'verify') return { state, ok: false, reason: '现在不在转会窗口阶段。' };
  if (!state.windowStarted) return { state, ok: false, reason: '转会窗口还没有开始。' };
  if (state.windowClosed) return { state, ok: false, reason: '转会窗口已经关闭。' };
  const next = log(
    {
      ...state,
      windowClosed: true,
      evidence: state.actionsTaken >= 1 ? { ...state.evidence, operatedMechanic: true } : state.evidence,
    },
    {
      phase: 'verify',
      action: 'window-close',
      label: `手动关闭转会窗口：已签下 ${signedCount(state)} 人`,
      before: { round: state.round, budget: state.budget, wage: state.wage },
      after: { budget: state.budget, wage: state.wage, signed: signedCount(state) },
      note: `剩余预算 ${formatFee(state.budget)}，剩余工资空间 ${formatWage(state.wage)}。`,
    },
  );
  return { state: next, ok: true };
}

export function reopenWindow(state: TransfersState): TransferActionResult {
  if (state.phase !== 'verify') return { state, ok: false, reason: '现在不在转会窗口阶段。' };
  if (!state.windowClosed) return { state, ok: false, reason: '转会窗口还没有关闭，不需要重开。' };
  const reset = createPlayers(state.rng);
  const next = log(
    {
      ...state,
      players: reset.players,
      rng: reset.rng,
      budget: TRANSFER_BUDGET,
      wage: TRANSFER_WAGE_SPACE,
      round: 1,
      windowClosed: false,
      actionsTaken: 0,
      transferResolved: false,
      transferSkipped: false,
    },
    {
      phase: 'verify',
      action: 'window-reopen',
      label: '重开转会窗口：预算与工资空间恢复，球员回到初始状态',
      before: { signed: signedCount(state), budget: state.budget },
      after: { signed: 0, budget: TRANSFER_BUDGET },
      note: '已安装的模块保留；本次窗口的真实报价记录仍保留在操作记录里。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   阶段推进与结算
   ========================================================================== */

export function advanceToTransfer(state: TransfersState): TransferActionResult {
  if (state.phase !== 'verify') return { state, ok: false, reason: '现在不在验证阶段。' };
  if (!state.windowClosed) return { state, ok: false, reason: '窗口还没有关闭，不能进入迁移阶段。' };
  if (!isGoalMet(state)) {
    return {
      state,
      ok: false,
      reason: `还需要至少签下 ${requiredSignings(state)} 人（当前 ${signedCount(state)} 人）。可以重开窗口再试一次。`,
    };
  }
  const next = log(
    { ...state, phase: 'transfer' },
    {
      phase: 'transfer',
      action: 'to-transfer',
      label: `进入迁移题：本次签下 ${signedCount(state)} 人`,
      before: { signed: signedCount(state) },
      after: { phase: 'transfer' },
      note: '迁移题只检验判断，不计分。',
    },
  );
  return { state: next, ok: true };
}

export function answerTransfer(state: TransfersState, optionId: string): TransferActionResult & { correct: boolean } {
  if (state.phase !== 'transfer') return { state, ok: false, correct: false, reason: '现在不在迁移阶段。' };
  if (optionId !== TRANSFER_QUIZ_CORRECT_ID) {
    return { state, ok: false, correct: false, reason: '这个判断还没有对上，看看选项下面的解释再试一次。' };
  }
  const next = log(
    {
      ...state,
      phase: 'summary',
      transferResolved: true,
      evidence: { ...state.evidence, transferred: true },
    },
    {
      phase: 'summary',
      action: 'transfer-correct',
      label: '迁移题正确：预算、工资、竞争与窗口共同约束报价',
      before: { phase: 'transfer' },
      after: { phase: 'summary' },
      note: '维修证据补全，可以归档。',
    },
  );
  return { state: next, ok: true, correct: true };
}

export function skipTransfer(state: TransfersState): TransferActionResult {
  if (state.phase !== 'transfer') return { state, ok: false, reason: '现在不在迁移阶段。' };
  if (state.mode !== 'showcase') return { state, ok: false, reason: '正常模式不能跳过迁移题。' };
  const next = log(
    { ...state, phase: 'summary', transferSkipped: true },
    {
      phase: 'summary',
      action: 'transfer-skip',
      label: '演示跳过迁移题（不计入 transferred）',
      before: { phase: 'transfer' },
      after: { phase: 'summary' },
      note: '演示模式只展示到验证阶段；迁移题标注为跳过。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   结算用的派生信息
   ========================================================================== */

export interface MissedTarget {
  name: string;
  reason: string;
}

/** 窗口关闭后仍未签下的目标与原因，全部来自真实状态与日志。 */
export function missedTargets(state: TransfersState): MissedTarget[] {
  return state.players
    .filter((player) => player.status !== 'signed')
    .map((player) => {
      if (player.status === 'lost') {
        return {
          name: player.name,
          reason: `第 ${player.lostRound ?? '?'} 轮被截胡：竞争对手兴趣达到 ${RIVAL_HIJACK_AT}。`,
        };
      }
      const failed = state.eventLog.filter(
        (entry) =>
          (entry.action === 'offer-low' || entry.action === 'offer-normal' || entry.action === 'offer-high') &&
          typeof entry.label === 'string' &&
          entry.label.includes(player.name) &&
          entry.label.includes('失败'),
      ).length;
      return {
        name: player.name,
        reason:
          failed > 0
            ? `窗口关闭时仍未签约：期间有 ${failed} 次报价被拒绝，对手兴趣停在 ${player.rivalInterest}。`
            : `窗口关闭时仍未签约：一次报价都没有发出，对手兴趣停在 ${player.rivalInterest}。`,
      };
    });
}

/** 故障版与修复版的对比行；数值只来自真实状态与日志。 */
export function transfersComparison(state: TransfersState): ComparisonRow[] {
  const faultLabels = state.eventLog.filter((entry) => entry.action === 'fault-sign').length;
  const offerActions = state.eventLog.filter(
    (entry) => entry.action === 'offer-low' || entry.action === 'offer-normal' || entry.action === 'offer-high',
  ).length;
  const waitActions = state.eventLog.filter((entry) => entry.action === 'wait').length;
  return buildComparisonRows([
    { label: '转会预算', fault: '不存在，想签就签', fixed: `${formatFee(TRANSFER_BUDGET)}，本次剩余 ${formatFee(state.budget)}` },
    { label: '工资空间', fault: '不存在', fixed: `${formatWage(TRANSFER_WAGE_SPACE)}，本次剩余 ${formatWage(state.wage)}` },
    { label: '竞争对手', fault: '不存在', fixed: `兴趣 0~${RIVAL_HIJACK_AT}，达到 ${RIVAL_HIJACK_AT} 即被截胡` },
    {
      label: '本次操作',
      fault: `直接签下 ${faultLabels} 次`,
      fixed: `报价 ${offerActions} 次 / 等待 ${waitActions} 次`,
    },
    {
      label: '本次结果',
      fault: `签下 ${state.faultSigned.length} / 3 人`,
      fixed: `签下 ${signedCount(state)} / ${state.players.length} 人（目标 ≥ ${requiredSignings(state)}）`,
    },
  ]);
}

/** 归档时写入 onComplete 的三条总结。 */
export function transferSummaryLines(state: TransfersState): string[] {
  const signed = signedPlayers(state);
  const signature = signed
    .map((player) => `${player.name}（第 ${player.signedRound ?? '?'} 轮签约，周薪 ${formatWage(player.wage)}）`)
    .join('、');
  return [
    `规则变化：装上转会预算（${formatFee(TRANSFER_BUDGET)}）与周薪空间（${formatWage(TRANSFER_WAGE_SPACE)}）后，转会费和经纪人佣金同时占预算，周薪同时占工资空间；3 轮窗口里，低价 / 正常 / 高价三档报价、等待与竞争对手兴趣共同决定结果。`,
    `决策变化：本次真实记录是报价/等待动作 ${state.actionsTaken} 次，最终签下 ${signed.length} 人${signature ? `（${signature}）` : ''}；每次报价都要在「现在锁定」和「再等一轮争取更低价」之间选择。`,
    `代价：等待会抬高竞争对手兴趣并可能被截胡，高价保证成交却多付 10%，低价可能被拒绝，预算或工资超限的签约直接被拒绝——窗口关闭时，「没签成」也是真实结果。`,
  ];
}

/* ==========================================================================
   存档恢复
   ========================================================================== */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function revivePlayer(raw: unknown): TransferPlayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const seed = PLAYER_SEEDS.find((item) => item.id === data.id);
  if (!seed) return null;
  if (typeof data.name !== 'string' || typeof data.position !== 'string') return null;
  if (!isFiniteNumber(data.valuation) || !isFiniteNumber(data.askingPrice)) return null;
  if (!isFiniteNumber(data.wage) || !isFiniteNumber(data.agentFee) || !isFiniteNumber(data.rivalInterest)) return null;
  if (data.status !== 'available' && data.status !== 'signed' && data.status !== 'lost') return null;
  if (data.signedRound !== null && !isFiniteNumber(data.signedRound)) return null;
  if (data.lostRound !== null && !isFiniteNumber(data.lostRound)) return null;
  return {
    id: seed.id,
    name: data.name,
    position: data.position,
    valuation: data.valuation,
    askingPrice: Math.max(1, data.askingPrice),
    wage: data.wage,
    agentFee: data.agentFee,
    rivalInterest: Math.min(RIVAL_HIJACK_AT, Math.max(0, data.rivalInterest)),
    status: data.status,
    signedRound: data.signedRound as number | null,
    lostRound: data.lostRound as number | null,
  };
}

function reviveEventLog(raw: unknown): EventLogEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: EventLogEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (!isFiniteNumber(entry.seq) || typeof entry.action !== 'string' || typeof entry.label !== 'string') return null;
    if (!isPhase(entry.phase)) return null;
    if (!entry.before || typeof entry.before !== 'object') return null;
    if (!entry.after || typeof entry.after !== 'object') return null;
    entries.push({
      seq: entry.seq,
      phase: entry.phase,
      action: entry.action,
      label: entry.label,
      before: entry.before as EventState,
      after: entry.after as EventState,
      delta: typeof entry.delta === 'string' ? entry.delta : undefined,
      note: typeof entry.note === 'string' ? entry.note : undefined,
    });
  }
  return entries;
}

/** 只接受结构完整的状态；损坏存档返回 null，由组件从头开始。 */
export function reviveTransfersState(raw: unknown): TransfersState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) return null;
  if (!isPhase(data.phase)) return null;
  if (data.mode !== 'normal' && data.mode !== 'showcase') return null;
  if (!isRngState(data.rng)) return null;
  const rng = reviveRng(data.rng);
  const eventLog = reviveEventLog(data.eventLog);
  if (!eventLog) return null;
  if (!Array.isArray(data.players) || data.players.length !== PLAYER_SEEDS.length) return null;
  const players: TransferPlayer[] = [];
  for (const item of data.players) {
    const player = revivePlayer(item);
    if (!player) return null;
    players.push(player);
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) return null;
  if (!data.modules || typeof data.modules !== 'object') return null;
  const modules = data.modules as Record<string, unknown>;
  if (typeof modules.budget !== 'boolean' || typeof modules.negotiation !== 'boolean') return null;
  if (!data.evidence || typeof data.evidence !== 'object') return null;
  const evidence = data.evidence as Record<string, unknown>;
  if (
    typeof evidence.experiencedFault !== 'boolean' ||
    typeof evidence.operatedMechanic !== 'boolean' ||
    typeof evidence.transferred !== 'boolean'
  ) {
    return null;
  }
  if (!Array.isArray(data.faultSigned)) return null;
  const faultSigned = data.faultSigned.filter((id): id is string => typeof id === 'string');
  if (faultSigned.length !== data.faultSigned.length) return null;
  const flags = [
    'fastPlay',
    'faultFinished',
    'diagnoseResolved',
    'windowStarted',
    'windowClosed',
    'transferResolved',
    'transferSkipped',
  ] as const;
  for (const key of flags) {
    if (typeof data[key] !== 'boolean') return null;
  }
  if (!isFiniteNumber(data.round) || data.round < 0) return null;
  if (!isFiniteNumber(data.actionsTaken) || data.actionsTaken < 0) return null;
  if (!isFiniteNumber(data.budget) || data.budget < 0) return null;
  if (!isFiniteNumber(data.wage) || data.wage < 0) return null;
  if (!isFiniteNumber(data.seed)) return null;

  return {
    version: 1,
    phase: data.phase,
    mode: data.mode,
    fastPlay: data.fastPlay as boolean,
    seed: data.seed,
    rng,
    eventLog,
    evidence: {
      experiencedFault: evidence.experiencedFault,
      operatedMechanic: evidence.operatedMechanic,
      transferred: evidence.transferred,
    },
    modules: { budget: modules.budget, negotiation: modules.negotiation },
    faultSigned,
    faultFinished: data.faultFinished as boolean,
    diagnoseResolved: data.diagnoseResolved as boolean,
    round: Math.max(1, Math.floor(data.round)),
    windowStarted: data.windowStarted as boolean,
    windowClosed: data.windowClosed as boolean,
    actionsTaken: data.actionsTaken,
    budget: data.budget,
    wage: data.wage,
    players,
    transferResolved: data.transferResolved as boolean,
    transferSkipped: data.transferSkipped as boolean,
  };
}

/* ==========================================================================
   界面用的只读描述
   ========================================================================== */

export const TRANSFER_RULE_LINES: { label: string; value: string }[] = [
  { label: '转会预算', value: `${formatFee(TRANSFER_BUDGET)}，转会费 + 经纪人佣金都从这里扣` },
  { label: '周薪空间', value: `${formatWage(TRANSFER_WAGE_SPACE)}，签约同时占用周薪` },
  { label: '窗口轮次', value: `${TRANSFER_ROUNDS} 轮，每轮只能报价 1 人或者等待 1 人` },
  { label: '低价报价', value: '支付要价 90%，对手兴趣 +30；兴趣 ≥ 50 时会被拒绝' },
  { label: '正常报价', value: '支付当前要价；兴趣 ≥ 80 时会被拒绝' },
  { label: '高价报价', value: '支付要价 110%，保证成交；对手兴趣 +5' },
  { label: '等待', value: '对手兴趣 +20，要价下降 10%（最后一轮不再下降）' },
  { label: '截胡', value: `每轮末未签约目标兴趣 +${RIVAL_ROUND_DRIFT}，达到 ${RIVAL_HIJACK_AT} 永久失去` },
];

export const TRANSFER_FAULT_NOTE =
  '没有预算、工资空间与竞争，报价只是点击按钮：签下谁、签下几个人都不会带来任何代价。';
