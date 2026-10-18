/**
 * 关卡三《转会窗》的纯规则层（v4）。
 *
 * v4 变化：
 * - 读取俱乐部跨关状态（转会预算 / 周薪空间 / 返工次数），不再写死预算；
 * - 每次验证未达成并「回到维修台重新配置」都记一次返工，俱乐部承担 €1M 谈判/经纪成本；
 * - 完成时提交 clubPatch（真实签约、绝对剩余预算、返工次数）。
 *
 * 模块池本身不再标注「正确 / 错误」：界面只展示实际效果与副作用，由玩家自己判断。
 *
 * 这一层不依赖 React / DOM，状态可 JSON 序列化；随机只用 engine/rng.ts。
 */

import { createRng, isRngState, nextInt, reviveRng } from '../../engine/rng';
import type { RngState } from '../../engine/rng';
import { buildComparisonRows, recordEvent } from '../../engine/events';
import type { ComparisonRow } from '../../engine/events';
import { createEvidence } from '../../engine/types';
import type {
  ClubPatch,
  ClubScoutCandidate,
  ClubSigning,
  ClubState,
  ClubUpdate,
  EventLogEntry,
  EventState,
  Evidence,
  GameMode,
  LevelPhase,
  QuizOption,
  ShowcaseOptions,
} from '../../engine/types';

/* ==========================================================================
   常量：所有数值都写在这里，测试与界面共用同一份来源。
   ========================================================================== */

/** 存档结构版本；v5 增加由球探室带入的额外目标。 */
export const TRANSFER_STATE_VERSION = 4;

/** 转会预算默认值：单位「万欧」，4500 万欧 = €45M（club 未定义时使用）。 */
export const TRANSFER_BUDGET = 4500;
/** 周薪空间默认值：单位「千欧/周」，350 千欧 = €350k/周（club 未定义时使用）。 */
export const TRANSFER_WAGE_SPACE = 350;
/** 每次返工由俱乐部承担的谈判 / 经纪成本：100 万欧 = €1M。 */
export const REWORK_COST = 100;
/** 最多读取 3 名球探候选，并从中最多加入 2 名额外目标。 */
export const SCOUT_TARGETS_READ_MAX = 3;
export const SCOUT_TARGETS_ADD_MAX = 2;
/** 球探室额外目标的确定性身价 / 周薪 / 佣金，按位置分类，单位分别是万欧、千欧、万欧。 */
export const SCOUT_TARGET_ECONOMICS: Record<'FW' | 'MF' | 'DF' | 'GK', { fee: number; wage: number; agentFee: number }> = {
  FW: { fee: 2200, wage: 160, agentFee: 90 },
  MF: { fee: 1800, wage: 130, agentFee: 70 },
  DF: { fee: 1600, wage: 120, agentFee: 60 },
  GK: { fee: 1100, wage: 80, agentFee: 40 },
};
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

/** 「清空预算砸巨星」错误模块：预算上限只剩 30%。 */
export const GALAXY_BUDGET_RATIO = 0.3;
/** 「清空预算砸巨星」错误模块：所有目标竞争兴趣 +30。 */
export const GALAXY_INTEREST_PENALTY = 30;
/** 「无限等待」副作用模块：每次等待额外增加的竞争兴趣。 */
export const INFINITE_WAIT_EXTRA_INTEREST = 25;
/** 「无限等待」副作用模块：等待时的要价下降比例。 */
export const INFINITE_WAIT_PRICE_CUT = 0.2;

/** 故障版候选只显示身价，不显示工资/佣金，也没有竞争。 */
export interface PlayerSeed {
  id: string;
  name: string;
  position: string;
  valuation: number;
  wage: number;
  agentFee: number;
  baseInterest: number;
  /** 是否本土青训。 */
  homegrown: boolean;
}

/** 三名候选全部为虚构球员。homegrown 表示本土青训身份，会随签约写入俱乐部档案。 */
export const PLAYER_SEEDS: PlayerSeed[] = [
  { id: 'jiang-ye', name: '江野', position: '边锋', valuation: 2200, wage: 160, agentFee: 80, baseInterest: 34, homegrown: true },
  { id: 'mula-ti', name: '木拉提', position: '中卫', valuation: 1600, wage: 120, agentFee: 50, baseInterest: 28, homegrown: false },
  { id: 'chen-yan', name: '陈砚', position: '门将', valuation: 1100, wage: 90, agentFee: 40, baseInterest: 18, homegrown: true },
];

/* ==========================================================================
   类型
   ========================================================================== */

export type TransferTier = 'low' | 'normal' | 'high';

export type TransferModuleId = 'budget' | 'negotiation' | 'galaxy' | 'infiniteWait';

export type TransferModules = Record<TransferModuleId, boolean>;

export const TRANSFER_MODULE_IDS: TransferModuleId[] = ['budget', 'negotiation', 'galaxy', 'infiniteWait'];

export interface TransferModuleInfo {
  id: TransferModuleId;
  name: string;
  englishName: string;
  description: string;
  sideEffect: string;
  kind: 'correct' | 'risky';
}

/** 四张模块卡的完整信息；正确模块的名称与关卡定义一致，错误模块只在本关生效。 */
export const TRANSFER_MODULE_POOL: TransferModuleInfo[] = [
  {
    id: 'budget',
    name: '预算与工资空间',
    englishName: 'Budget & Wages',
    description: '转会预算与周薪空间分别记账，签约同时占用两者；超出任意一项都无法完成注册。',
    sideEffect: '把预算全砸在一名球星上，可能连替补的工资空间都不剩。',
    kind: 'correct',
  },
  {
    id: 'negotiation',
    name: '报价与谈判',
    englishName: 'Negotiation',
    description: '报价分档，等待可能压低价格，也可能引来竞争对手；窗口结束前必须完成目标。',
    sideEffect: '一味等待会把「省钱」变成「错过」；过早砸钱则失去议价空间。',
    kind: 'correct',
  },
  {
    id: 'galaxy',
    name: '清空预算砸巨星',
    englishName: 'Galácticos',
    description: '把几乎全部预算押在巨星身上：预算上限只剩 30%，但所有目标的竞争兴趣 +30。',
    sideEffect: '预算 €45M → €13.5M，3 名目标兴趣 +30。看起来像豪赌，实际上很难完成 2 笔签约。',
    kind: 'risky',
  },
  {
    id: 'infiniteWait',
    name: '无限等待',
    englishName: 'Eternal Waiting',
    description: '教练组可以无限期等待：等待时压价幅度更大，但每次等待额外 +25 竞争兴趣。',
    sideEffect: '等待压价 20%（原 10%），但单次等待共 +45 兴趣，再加轮末 +10；很容易等到被截胡。',
    kind: 'risky',
  },
];

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
  /** 是否本土青训。 */
  homegrown: boolean;
  /** 实际支付的转会费（不含佣金），签约成功时写入，单位万欧。 */
  paidFee: number | null;
  /** 竞争对手兴趣 0~100。 */
  rivalInterest: number;
  status: 'available' | 'signed' | 'lost';
  signedRound: number | null;
  lostRound: number | null;
  /** 目标来源：原窗口目标，或由球探室报告带入。 */
  source: 'window' | 'scout';
  /** 球探知识度 0~100；仅球探室目标有。 */
  knowledge?: number;
  /** 球探报告的区域描述（中性化）。 */
  scoutRegionLabel?: string;
}

export interface TransfersState {
  version: typeof TRANSFER_STATE_VERSION;
  phase: LevelPhase;
  mode: GameMode;
  fastPlay: boolean;
  seed: number;
  rng: RngState;
  eventLog: EventLogEntry[];
  evidence: Evidence;
  modules: TransferModules;
  /** 第几次进入验证（重新配置后 +1，用于区分重试；返工次数 = verifyAttempt - 1）。 */
  verifyAttempt: number;
  /** 俱乐部提供的起始转会预算，单位万欧。 */
  startTransferBudget: number;
  /** 俱乐部提供的起始周薪空间，单位千欧/周。 */
  startWageBudget: number;
  /** 进入本关时俱乐部历史上的返工次数（仅用于展示，不计入本关提交）。 */
  clubFailures: number;
  /** 球探室提交的候选（最多读取 3 名；开始窗口时最多加入 2 名额外目标）。 */
  scoutTargets: ClubScoutCandidate[];
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

export interface OfferPreview {
  tier: TransferTier;
  fee: number;
  totalCost: number;
  allowed: boolean;
  blockedReason?: string;
  expectedSuccess: boolean;
  condition: string;
  interestNow: number;
  interestOnFail: number;
  failureInterestGain: number;
  budgetAfter: number | null;
  wageAfter: number | null;
  expectedText: string;
}

export interface WaitPreview {
  interestGain: number;
  priceCutRatio: number;
  canCutPrice: boolean;
  text: string;
}

export interface CreateTransfersOptions {
  mode: GameMode;
  seed: number;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
  /** 正常模式下的跨关俱乐部状态；展示模式为 undefined。 */
  club?: ClubState;
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

/** 本关已经发生的返工次数（每次「回到维修台重新配置」+1）。 */
export function reworkCount(state: TransfersState): number {
  return Math.max(0, state.verifyAttempt - 1);
}

/** 俱乐部因返工累计承担的谈判 / 经纪成本，单位万欧。 */
export function reworkCostPaid(state: TransfersState): number {
  return reworkCount(state) * REWORK_COST;
}

/** 扣除返工成本后、再应用模块效果的基础预算上限。 */
export function budgetBase(state: TransfersState): number {
  return Math.max(0, state.startTransferBudget - reworkCostPaid(state));
}

/** 当前模块配置下的转会预算上限；「砸巨星」模块会让剩余预算再只剩 30%。 */
export function budgetLimit(state: TransfersState): number {
  return state.modules.galaxy ? Math.floor(budgetBase(state) * GALAXY_BUDGET_RATIO) : budgetBase(state);
}

/** 当前模块配置下的周薪空间上限（来自俱乐部跨关状态）。 */
export function wageLimit(state: TransfersState): number {
  return Math.max(0, state.startWageBudget);
}

/** 验证配置是否完整：缺规则时本次结果无效（界面只提示「配置不完整」，不点名模块）。 */
export function verificationValid(state: TransfersState): boolean {
  return state.modules.budget && state.modules.negotiation;
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

/** 没有谈判模块时，报价退化为「按要价直接成交」，档位不再有区别。 */
export function tierFee(state: TransfersState, player: TransferPlayer, tier: TransferTier): number {
  if (!state.modules.negotiation) return player.askingPrice;
  if (tier === 'low') return Math.round(player.askingPrice * LOW_OFFER_RATIO);
  if (tier === 'high') return Math.round(player.askingPrice * HIGH_OFFER_RATIO);
  return player.askingPrice;
}

/** 这一档报价在当前状态下是否被允许，以及需要花多少钱。 */
export function canOffer(state: TransfersState, playerId: string, tier: TransferTier): OfferCheck {
  const player = state.players.find((item) => item.id === playerId);
  const fee = player ? tierFee(state, player, tier) : 0;
  const totalCost = player ? fee + player.agentFee : 0;
  if (state.phase !== 'verify') return { ok: false, reason: '现在不在转会窗口阶段。', fee, totalCost };
  if (!state.windowStarted) return { ok: false, reason: '转会窗口还没有开始。', fee, totalCost };
  if (state.windowClosed) return { ok: false, reason: '转会窗口已经关闭。', fee, totalCost };
  if (!player) return { ok: false, reason: '找不到这名候选。', fee, totalCost };
  if (player.status === 'signed') return { ok: false, reason: `${player.name} 已经签约。`, fee, totalCost };
  if (player.status === 'lost') return { ok: false, reason: `${player.name} 已经被竞争对手截胡。`, fee, totalCost };
  if (tier !== 'low' && tier !== 'normal' && tier !== 'high') {
    return { ok: false, reason: '报价档位无效。', fee, totalCost };
  }
  if (state.round > roundLimit(state)) return { ok: false, reason: '转会窗口已经结束。', fee, totalCost };
  if (state.modules.budget) {
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
  }
  return { ok: true, fee, totalCost };
}

/** 报价前的预计结果与风险，供界面直接展示，玩家不用读长规则。 */
export function previewOffer(state: TransfersState, playerId: string, tier: TransferTier): OfferPreview | null {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return null;
  const check = canOffer(state, playerId, tier);
  const negotiationOn = state.modules.negotiation;
  const expectedSuccess =
    !negotiationOn || tier === 'high'
      ? true
      : tier === 'low'
        ? player.rivalInterest < LOW_OFFER_MAX_INTEREST
        : player.rivalInterest < NORMAL_OFFER_MAX_INTEREST;
  const failureInterestGain = tier === 'low' ? RIVAL_LOW_OFFER : tier === 'normal' ? 15 : RIVAL_HIGH_OFFER;
  const interestOnFail = Math.min(RIVAL_HIJACK_AT, player.rivalInterest + failureInterestGain);
  const budgetAfter = state.modules.budget ? state.budget - check.totalCost : null;
  const wageAfter = state.modules.budget ? state.wage - player.wage : null;
  const condition = !negotiationOn
    ? '报价与谈判未启用：报价直接成交，没有竞争。'
    : tier === 'high'
      ? `高价报价保证成交；对手兴趣 +${RIVAL_HIGH_OFFER}。`
      : tier === 'low'
        ? `低价成交条件：竞争对手兴趣 < ${LOW_OFFER_MAX_INTEREST}（当前 ${player.rivalInterest}）。`
        : `正常成交条件：竞争对手兴趣 < ${NORMAL_OFFER_MAX_INTEREST}（当前 ${player.rivalInterest}）。`;
  const expectedText = !expectedSuccess
    ? `预计会被拒绝；失败后兴趣 ${player.rivalInterest} → ${interestOnFail}（轮末未签约再 +${RIVAL_ROUND_DRIFT}）。`
    : tier === 'high'
      ? '预计成交：保证签约，但多付 10% 转会费。'
      : !negotiationOn
        ? '预计成交：没有竞争，直接按要价签约。'
        : `预计成交；对手兴趣会上升到 ${Math.min(RIVAL_HIJACK_AT, player.rivalInterest + failureInterestGain)}（如果还有下一轮）。`;
  return {
    tier,
    fee: check.fee,
    totalCost: check.totalCost,
    allowed: check.ok,
    blockedReason: check.reason,
    expectedSuccess,
    condition,
    interestNow: player.rivalInterest,
    interestOnFail,
    failureInterestGain,
    budgetAfter,
    wageAfter,
    expectedText,
  };
}

/** 等待前的预计效果。 */
export function previewWait(state: TransfersState): WaitPreview {
  const negotiationOn = state.modules.negotiation;
  const interestGain = !negotiationOn ? 0 : RIVAL_WAIT + (state.modules.infiniteWait ? INFINITE_WAIT_EXTRA_INTEREST : 0);
  const priceCutRatio = !negotiationOn ? 0 : state.modules.infiniteWait ? INFINITE_WAIT_PRICE_CUT : WAIT_PRICE_CUT;
  const canCutPrice = negotiationOn && state.round < roundLimit(state);
  return {
    interestGain,
    priceCutRatio,
    canCutPrice,
    text: !negotiationOn
      ? '报价与谈判未启用：等待不会压低要价，也不会改变竞争兴趣。'
      : `等待：要价 ${canCutPrice ? `-${Math.round(priceCutRatio * 100)}%` : '不再下降'}，竞争对手兴趣 +${interestGain}，轮末未签约目标再 +${RIVAL_ROUND_DRIFT}。`,
  };
}

export function waitInterestGain(state: TransfersState): number {
  return state.modules.negotiation
    ? RIVAL_WAIT + (state.modules.infiniteWait ? INFINITE_WAIT_EXTRA_INTEREST : 0)
    : 0;
}

export function waitPriceCutRatio(state: TransfersState): number {
  if (!state.modules.negotiation) return 0;
  return state.modules.infiniteWait ? INFINITE_WAIT_PRICE_CUT : WAIT_PRICE_CUT;
}

function snapshot(state: TransfersState, extra: EventState = {}): EventState {
  return {
    round: state.round,
    budget: state.budget,
    wage: state.wage,
    signed: signedCount(state),
    attempt: state.verifyAttempt,
    ...extra,
  };
}

function log(state: TransfersState, input: Parameters<typeof recordEvent>[1]): TransfersState {
  return { ...state, eventLog: recordEvent(state.eventLog, input) };
}

/** 球探报告区域的中性化描述，不引入真实联赛/俱乐部名称。 */
export const SCOUT_REGION_LABELS: Record<string, string> = {
  local: '本地球探网络',
  'southern-europe': '南欧球探网络',
  'northern-europe': '北欧球探网络',
  'south-america': '南美球探网络',
};

/** 把球探提交的候选规整成可用的额外目标数据；最多读取 3 名。 */
export function normalizeScoutTargets(raw: unknown): ClubScoutCandidate[] {
  if (!Array.isArray(raw)) return [];
  const result: ClubScoutCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) continue;
    if (typeof candidate.name !== 'string' || !candidate.name.trim()) continue;
    if (typeof candidate.position !== 'string' || !candidate.position.trim()) continue;
    if (typeof candidate.region !== 'string') continue;
    const knowledge = typeof candidate.knowledge === 'number' && Number.isFinite(candidate.knowledge)
      ? Math.min(100, Math.max(0, Math.round(candidate.knowledge)))
      : 0;
    result.push({
      id: candidate.id,
      name: candidate.name,
      position: candidate.position,
      region: candidate.region,
      knowledge,
    });
    if (result.length >= SCOUT_TARGETS_READ_MAX) break;
  }
  return result;
}

/** 把中文位置映射成四类位置，用于确定性身价/周薪。 */
export function scoutPositionClass(position: string): 'FW' | 'MF' | 'DF' | 'GK' {
  const raw = position.trim();
  if (/门将|守门/.test(raw)) return 'GK';
  if (/后卫|中卫|边卫|DF/i.test(raw)) return 'DF';
  if (/中场|后腰|前腰|边前卫|MF/i.test(raw)) return 'MF';
  return 'FW';
}

/** 知识度越高，竞争兴趣越低（越确定的目标越少人抢）。 */
export function scoutTargetRivalInterest(knowledge: number): number {
  const clamped = Math.min(100, Math.max(0, knowledge));
  return Math.min(90, Math.max(10, 25 + Math.round((100 - clamped) * 0.55)));
}

/** 由球探报告生成一名额外目标；位置决定确定性费用，知识度决定竞争兴趣。 */
export function buildScoutPlayer(target: ClubScoutCandidate): TransferPlayer {
  const positionClass = scoutPositionClass(target.position);
  const economics = SCOUT_TARGET_ECONOMICS[positionClass];
  return {
    id: `scout-${target.id}`,
    name: target.name,
    position: target.position,
    valuation: economics.fee,
    askingPrice: economics.fee,
    wage: economics.wage,
    agentFee: economics.agentFee,
    // 本地球探网络发现的球员视为本土青训，其他区域不是。
    homegrown: target.region === 'local',
    paidFee: null,
    rivalInterest: scoutTargetRivalInterest(target.knowledge),
    status: 'available',
    signedRound: null,
    lostRound: null,
    source: 'scout',
    knowledge: Math.min(100, Math.max(0, Math.round(target.knowledge))),
    scoutRegionLabel: SCOUT_REGION_LABELS[target.region] ?? '球探室报告',
  };
}

/** 到窗口开始时才追加球探目标；最多 SCOUT_TARGETS_ADD_MAX 名，且不重复追加。 */
function appendScoutTargets(players: TransferPlayer[], targets: ClubScoutCandidate[]): TransferPlayer[] {
  const existingIds = new Set(players.map((player) => player.id));
  const extras = targets
    .slice(0, SCOUT_TARGETS_ADD_MAX)
    .map((target) => buildScoutPlayer(target))
    .filter((player) => !existingIds.has(player.id));
  return extras.length > 0 ? [...players, ...extras] : players;
}

function createPlayers(rng: RngState, galaxyPenalty = false): { players: TransferPlayer[]; rng: RngState } {
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
      homegrown: seed.homegrown,
      paidFee: null,
      rivalInterest: seed.baseInterest + draw.value + (galaxyPenalty ? GALAXY_INTEREST_PENALTY : 0),
      status: 'available' as const,
      signedRound: null,
      lostRound: null,
      source: 'window' as const,
    };
  });
  return { players, rng: current };
}

function moduleNames(state: TransfersState): string {
  const on = TRANSFER_MODULE_POOL.filter((module) => state.modules[module.id]).map((module) => module.name);
  return on.length > 0 ? on.join(' + ') : '未安装任何模块';
}

/* ==========================================================================
   初始状态
   ========================================================================== */

export function createTransfersState(options: CreateTransfersOptions): TransfersState {
  const summon = createPlayers(createRng(options.seed));
  const showcase = options.showcaseOptions;
  const club = options.club;
  const scoutTargets = normalizeScoutTargets(club?.scoutedCandidates);
  const startTransferBudget = club ? Math.max(0, Math.round(club.transferBudget * 100)) : TRANSFER_BUDGET;
  const startWageBudget = club ? Math.max(0, club.wageBudget) : TRANSFER_WAGE_SPACE;
  let phase: LevelPhase = options.fastStart ? 'faultPlay' : 'commission';
  let modules: TransferModules = { budget: false, negotiation: false, galaxy: false, infiniteWait: false };
  let windowStarted = false;

  if (showcase) {
    if (showcase.startPhase === 'faultPlay') {
      phase = 'faultPlay';
    } else if (showcase.startPhase === 'repair') {
      phase = 'repair';
    } else if (showcase.startPhase === 'verify') {
      phase = 'verify';
      modules = { budget: true, negotiation: true, galaxy: false, infiniteWait: false };
      windowStarted = true;
    } else {
      phase = 'commission';
    }
  }

  const baseBudget = startTransferBudget;
  const players = windowStarted ? appendScoutTargets(summon.players, scoutTargets) : summon.players;

  return {
    version: TRANSFER_STATE_VERSION,
    phase,
    mode: options.mode,
    fastPlay: showcase?.fastPlay ?? false,
    seed: options.seed,
    rng: summon.rng,
    eventLog: [],
    evidence: createEvidence(),
    modules,
    verifyAttempt: 1,
    startTransferBudget,
    startWageBudget,
    clubFailures: club ? Math.max(0, club.failures) : 0,
    scoutTargets,
    faultSigned: [],
    faultFinished: false,
    diagnoseResolved: false,
    round: 1,
    windowStarted,
    windowClosed: false,
    actionsTaken: 0,
    budget: modules.galaxy ? Math.floor(baseBudget * GALAXY_BUDGET_RATIO) : baseBudget,
    wage: startWageBudget,
    players,
    transferResolved: false,
    transferSkipped: false,
  };
}

/** 供展示模式 / 测试直接拿到窗口内的状态。 */
export function readyWindowState(seed: number, fastPlay = false): TransfersState {
  const initial = createTransfersState({ mode: 'normal', seed, fastStart: true, showcaseOptions: null });
  return {
    ...initial,
    phase: 'verify',
    modules: { budget: true, negotiation: true, galaxy: false, infiniteWait: false },
    faultSigned: ['jiang-ye'],
    faultFinished: true,
    diagnoseResolved: true,
    windowStarted: true,
    budget: initial.startTransferBudget,
    wage: initial.startWageBudget,
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
      note: '接下来从模块池里选择要安装的规则；装错模块也能开始验证，但结果会变差。',
    },
  );
  return { state: next, ok: true };
}

export function setModule(state: TransfersState, moduleId: TransferModuleId, installed: boolean): TransferActionResult {
  if (state.phase !== 'repair') return { state, ok: false, reason: '只有在维修阶段可以安装模块。' };
  if (state.windowStarted) return { state, ok: false, reason: '转会窗口已经开始，模块已锁定；修改需要回到维修台重新配置。' };
  if (!TRANSFER_MODULE_IDS.includes(moduleId)) return { state, ok: false, reason: '未知模块。' };
  const info = TRANSFER_MODULE_POOL.find((module) => module.id === moduleId);
  const label = info?.name ?? moduleId;
  const next = log(
    { ...state, modules: { ...state.modules, [moduleId]: installed } },
    {
      phase: 'repair',
      action: 'module',
      label: `${installed ? '安装' : '卸载'}模块：${label}`,
      before: { modules: moduleNames(state) },
      after: { modules: moduleNames({ ...state, modules: { ...state.modules, [moduleId]: installed } }) },
      note: installed ? (info?.sideEffect ?? '规则已启用。') : '规则已退化，相关代价不再生效。',
    },
  );
  return { state: next, ok: true };
}

export function startWindow(state: TransfersState): TransferActionResult {
  if (state.phase !== 'repair') return { state, ok: false, reason: '现在不在维修阶段。' };
  if (state.windowStarted) return { state, ok: false, reason: '转会窗口已经开始。' };
  const withScouts = appendScoutTargets(state.players, state.scoutTargets);
  const scoutAdded = withScouts.length - state.players.length;
  let players = withScouts;
  if (state.modules.galaxy) {
    players = players.map((player) =>
      player.status === 'available'
        ? { ...player, rivalInterest: Math.min(RIVAL_HIJACK_AT, player.rivalInterest + GALAXY_INTEREST_PENALTY) }
        : player,
    );
  }
  const next = log(
    {
      ...state,
      phase: 'verify',
      windowStarted: true,
      round: 1,
      windowClosed: false,
      actionsTaken: 0,
      budget: budgetLimit(state),
      wage: wageLimit(state),
      players,
    },
    {
      phase: 'verify',
      action: 'window-open',
      label: `开始 ${roundLimit(state)} 轮转会窗口（${moduleNames(state)}${
        scoutAdded > 0 ? `；球探室带来 ${scoutAdded} 名目标` : ''
      }）`,
      before: { round: 0, budget: budgetLimit(state), wage: wageLimit(state) },
      after: { round: 1, budget: budgetLimit(state), wage: wageLimit(state), targets: players.length },
      note: verificationValid(state)
        ? `每轮只能对 1 名目标报价或等待；至少签下 ${requiredSignings(state)} 人。`
        : '这次验证配置不完整：结果会真实记录，但归档会被阻止。',
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

  if (state.modules.negotiation) {
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
  }

  const round = nextRound;
  const limit = roundLimit(state);
  const closed = round > limit;
  next = {
    ...next,
    round: Math.min(round, limit + 1),
    windowClosed: closed,
    evidence:
      closed && state.actionsTaken >= 1 && verificationValid(state)
        ? { ...state.evidence, operatedMechanic: true }
        : next.evidence,
  };

  if (closed) {
    next = log(next, {
      phase: 'verify',
      action: 'window-close',
      label: `转会窗口关闭：已签下 ${signedCount(next)} / ${requiredSignings(next)} 人`,
      before: { round: limit, budget: next.budget, wage: next.wage },
      after: { round: next.round, budget: next.budget, wage: next.wage, signed: signedCount(next) },
      note: verificationValid(next)
        ? `剩余预算 ${formatFee(next.budget)}，剩余工资空间 ${formatWage(next.wage)}。`
        : '验证配置不完整，本次结果不能算作有效维修。',
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
  const negotiationOn = state.modules.negotiation;
  const success =
    !negotiationOn || tier === 'high'
      ? true
      : tier === 'low'
        ? beforeInterest < LOW_OFFER_MAX_INTEREST
        : beforeInterest < NORMAL_OFFER_MAX_INTEREST;
  const interestGain = !negotiationOn ? 0 : tier === 'low' ? RIVAL_LOW_OFFER : tier === 'high' ? RIVAL_HIGH_OFFER : 15;
  const afterInterest = Math.min(RIVAL_HIJACK_AT, beforeInterest + interestGain);

  const players = state.players.map((item) => {
    if (item.id !== player.id) return item;
    if (success) {
      return {
        ...item,
        status: 'signed' as const,
        signedRound: state.round,
        rivalInterest: beforeInterest,
        paidFee: check.fee,
      };
    }
    return { ...item, rivalInterest: afterInterest };
  });

  const deduct = state.modules.budget;
  const nextBudget = deduct ? state.budget - check.totalCost : state.budget;
  const nextWage = deduct ? state.wage - player.wage : state.wage;
  const signedNow = signedCount({ ...state, players });

  let next: TransfersState = {
    ...state,
    players,
    budget: nextBudget,
    wage: nextWage,
    actionsTaken: state.actionsTaken + 1,
  };

  const failReason = !negotiationOn
    ? '报价与谈判未启用：报价直接成交，没有竞争。'
    : tier === 'low'
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
      ? deduct
        ? `-${formatFee(check.totalCost)} / -${formatWage(player.wage)}`
        : '预算规则未启用：本次签约不扣预算（验证无效）'
      : `兴趣 +${interestGain}`,
    note: success
      ? !negotiationOn
        ? '报价与谈判未启用：这次签约没有档位、竞争与议价，本次验证不算有效维修。'
        : tier === 'low'
          ? `低价报价按要价九折成交，但竞争对手兴趣也上升到 ${afterInterest}（如果还有下一轮）。`
          : tier === 'high'
            ? '高价报价保证成交，但多付了 10% 的转会费。'
            : '正常报价按当前要价成交。'
      : failReason,
  });

  return { state: endRound(next), ok: true };
}

export function offer(state: TransfersState, playerId: string, tier: TransferTier): TransferActionResult {
  return applyOffer(state, playerId, tier);
}

/** 兼容更直白的调用名。 */
export const makeOffer = offer;

export function waitTarget(state: TransfersState, playerId: string): TransferActionResult {
  const check = canWaitTarget(state, playerId);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return { state, ok: false, reason: '找不到这名候选。' };

  const beforeInterest = player.rivalInterest;
  const negotiationOn = state.modules.negotiation;
  const gain = waitInterestGain(state);
  const cutRatio = waitPriceCutRatio(state);
  const canCut = negotiationOn && state.round < roundLimit(state);
  const nextAsking = canCut
    ? Math.max(MIN_ASKING_PRICE, Math.round(player.askingPrice * (1 - cutRatio)))
    : player.askingPrice;
  const afterInterest = Math.min(RIVAL_HIJACK_AT, beforeInterest + gain);

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
    delta: negotiationOn ? `兴趣 +${gain}` : '等待无效果（谈判模块未启用）',
    note: !negotiationOn
      ? '报价与谈判未启用：等待不会压价，也不会改变竞争兴趣。'
      : canCut
        ? `等待让要价下降 ${Math.round(cutRatio * 100)}%，但竞争对手兴趣 +${gain}；轮末未签约目标继续 +${RIVAL_ROUND_DRIFT}。`
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
      evidence:
        state.actionsTaken >= 1 && verificationValid(state)
          ? { ...state.evidence, operatedMechanic: true }
          : state.evidence,
    },
    {
      phase: 'verify',
      action: 'window-close',
      label: `手动关闭转会窗口：已签下 ${signedCount(state)} 人`,
      before: { round: state.round, budget: state.budget, wage: state.wage },
      after: { budget: state.budget, wage: state.wage, signed: signedCount(state) },
      note: verificationValid(state)
        ? `剩余预算 ${formatFee(state.budget)}，剩余工资空间 ${formatWage(state.wage)}。`
        : '验证配置不完整，本次结果不能算作有效维修。',
    },
  );
  return { state: next, ok: true };
}

/** 「回到维修台重新配置」：清空本次验证成绩，俱乐部承担 €1M 谈判/经纪成本。 */
export function reconfigure(state: TransfersState): TransferActionResult {
  if (state.phase !== 'verify') return { state, ok: false, reason: '只有在验证阶段可以回到维修台重新配置。' };
  if (!state.windowClosed) return { state, ok: false, reason: '先结束本次转会窗口，再回到维修台重新配置。' };
  const rolled = createPlayers(state.rng);
  const keptLog = state.eventLog.filter((entry) => entry.phase !== 'verify');
  const nextAttempt = state.verifyAttempt + 1;
  const nextBase: TransfersState = {
    ...state,
    phase: 'repair',
    players: rolled.players,
    rng: rolled.rng,
    round: 1,
    windowStarted: false,
    windowClosed: false,
    actionsTaken: 0,
    transferResolved: false,
    transferSkipped: false,
    verifyAttempt: nextAttempt,
    eventLog: keptLog,
    evidence: { ...state.evidence, operatedMechanic: false, transferred: false },
  };
  const next = log(
    {
      ...nextBase,
      budget: budgetLimit(nextBase),
      wage: wageLimit(nextBase),
    },
    {
      phase: 'repair',
      action: 'reconfigure',
      label: `回到维修台重新配置（第 ${nextAttempt} 次验证）`,
      before: { attempt: state.verifyAttempt, signed: signedCount(state), budget: state.budget },
      after: { attempt: nextAttempt, phase: 'repair', budget: budgetLimit(nextBase) },
      delta: `俱乐部承担 ${formatFee(REWORK_COST)} 返工成本`,
      note: `每次未达成后的重新配置都会记一次返工：俱乐部承担 ${formatFee(REWORK_COST)} 谈判/经纪成本，从转会预算扣除（最低 0）。本轮验证成绩已清空，故障试玩、诊断与模块选择证据保留。`,
    },
  );
  return { state: next, ok: true };
}

export function reopenWindow(state: TransfersState): TransferActionResult {
  if (state.phase !== 'verify') return { state, ok: false, reason: '现在不在转会窗口阶段。' };
  if (!state.windowClosed) return { state, ok: false, reason: '转会窗口还没有关闭，不需要重开。' };
  const rolled = createPlayers(state.rng);
  let reopenPlayers = appendScoutTargets(rolled.players, state.scoutTargets);
  if (state.modules.galaxy) {
    reopenPlayers = reopenPlayers.map((player) =>
      player.status === 'available'
        ? { ...player, rivalInterest: Math.min(RIVAL_HIJACK_AT, player.rivalInterest + GALAXY_INTEREST_PENALTY) }
        : player,
    );
  }
  const next = log(
    {
      ...state,
      players: reopenPlayers,
      rng: rolled.rng,
      budget: budgetLimit(state),
      wage: wageLimit(state),
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
      after: { signed: 0, budget: budgetLimit(state) },
      note: '已安装的模块保留；本次窗口的真实报价记录仍保留在操作记录里。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   阶段推进与结算
   ========================================================================== */

/** 还不能归档的具体原因；空数组表示可以进入迁移题。 */
export function archiveProblems(state: TransfersState): string[] {
  const problems: string[] = [];
  if (!state.windowStarted) problems.push('转会窗口还没有开始。');
  if (!state.windowClosed) problems.push('转会窗口还没有关闭，先结束本次窗口。');
  if (signedCount(state) < requiredSignings(state)) {
    problems.push(`签约人数不足：只签下 ${signedCount(state)} / ${requiredSignings(state)} 人。`);
  }
  if (!verificationValid(state)) {
    problems.push('验证配置不完整：有规则没有安装，本次结果不能算作有效维修。');
  }
  return problems;
}

export function archiveBlockedReason(state: TransfersState): string | null {
  const problems = archiveProblems(state);
  return problems.length > 0 ? problems[0] : null;
}

/** 是否可以离开验证阶段进入迁移题：目标达成 + 正确模块齐备。 */
export function canAdvanceToTransfer(state: TransfersState): boolean {
  return state.windowClosed && isGoalMet(state) && verificationValid(state);
}

export function advanceToTransfer(state: TransfersState): TransferActionResult {
  if (state.phase !== 'verify') return { state, ok: false, reason: '现在不在验证阶段。' };
  if (!canAdvanceToTransfer(state)) {
    return {
      state,
      ok: false,
      reason: `还不能归档：${archiveProblems(state).join('；')}`,
    };
  }
  const next = log(
    { ...state, phase: 'transfer' },
    {
      phase: 'transfer',
      action: 'to-transfer',
      label: `进入迁移题：本次签下 ${signedCount(state)} 人（第 ${state.verifyAttempt} 次验证）`,
      before: { signed: signedCount(state), attempt: state.verifyAttempt },
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
          entry.phase === 'verify' &&
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
    (entry) =>
      entry.phase === 'verify' &&
      (entry.action === 'offer-low' || entry.action === 'offer-normal' || entry.action === 'offer-high'),
  ).length;
  const waitActions = state.eventLog.filter((entry) => entry.phase === 'verify' && entry.action === 'wait').length;
  return buildComparisonRows([
    {
      label: '转会预算',
      fault: '不存在，想签就签',
      fixed: `${formatFee(budgetLimit(state))}，本次剩余 ${formatFee(state.budget)}`,
    },
    {
      label: '工资空间',
      fault: '不存在',
      fixed: `${formatWage(wageLimit(state))}，本次剩余 ${formatWage(state.wage)}`,
    },
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
  const spend = Math.max(0, budgetBase(state) - state.budget);
  const reworks = reworkCount(state);
  return [
    `规则变化：这次从俱乐部继承转会预算 ${formatFee(state.startTransferBudget)} 与周薪空间 ${formatWage(state.startWageBudget)}。转会费和经纪人佣金同时占预算，周薪同时占工资空间；3 轮窗口里，低价 / 正常 / 高价三档报价、等待与竞争对手兴趣共同决定结果。`,
    `决策变化：第 ${state.verifyAttempt} 次验证共报价/等待 ${state.actionsTaken} 次，本次花费 ${formatFee(spend)}，签下 ${signed.length} 人${signature ? `（${signature}）` : ''}；返工 ${reworks} 次，俱乐部承担 ${formatFee(reworks * REWORK_COST)} 成本。`,
    `代价：等待会抬高竞争对手兴趣并可能被截胡，高价保证成交却多付 10%，低价可能被拒绝；每次未达成后的重新配置都从转会预算里扣 ${formatFee(REWORK_COST)}，失败会一直影响俱乐部的钱。`,
  ];
}

/** 俱乐部时间线：只写真实签约、返工成本、预算变化与跨关引援。 */
export function buildTransfersClubUpdate(state: TransfersState): ClubUpdate {
  const signed = signedPlayers(state);
  const spend = Math.max(0, budgetBase(state) - state.budget);
  const wageAdded = Math.max(0, state.startWageBudget - state.wage);
  const missed = missedTargets(state);
  const reworks = reworkCount(state);
  const scoutPlayers = state.players.filter((player) => player.source === 'scout');
  const scoutDetail =
    scoutPlayers.length > 0
      ? `球探室带来的目标：${scoutPlayers
          .map((player) => `${player.name}（${player.position}，知识度 ${player.knowledge ?? 0}%，竞争兴趣 ${player.rivalInterest}）`)
          .join('；')}。`
      : state.scoutTargets.length > 0
        ? '球探室带来的目标：本局没有把球探报告加入转会窗口。'
        : '球探室带来的目标：本局没有球探报告。';
  const details = [
    `转会窗：第 ${state.verifyAttempt} 次验证、返工 ${reworks} 次，报价/等待 ${state.actionsTaken} 次，签下 ${signed.length} 人${
      signed.length > 0
        ? `（${signed.map((player) => `${player.name} 第 ${player.signedRound ?? '?'} 轮`).join('、')}）`
        : ''
    }。`,
    `预算：俱乐部起始 ${formatFee(state.startTransferBudget)}，本次花费 ${formatFee(spend)}，返工成本 ${formatFee(
      reworks * REWORK_COST,
    )}，剩余 ${formatFee(state.budget)}；新增周薪 ${formatWage(wageAdded)}，剩余 ${formatWage(state.wage)} / ${formatWage(state.startWageBudget)}。`,
    missed.length > 0
      ? `错过：${missed.map((item) => `${item.name}（${item.reason}）`).join('；')}`
      : '错过：没有目标在窗口里流失。',
    `跨关引援：${
      signed.length > 0 ? signed.map((player) => `${player.name}（${player.position}）`).join('、') : '本次没有签下球员'
    }将进入赛季名单；模块：${moduleNames(state)}${verificationValid(state) ? '（验证有效）' : '（验证配置不完整）'}。`,
    scoutDetail,
  ];
  return {
    headline: `转会窗关闭：签下 ${signed.length}/${state.players.length} 人，花费 ${formatFee(spend)}，返工 ${reworks} 次`,
    details,
    nextBrief: '下一份委托：把新援注册进 25 人名单，补齐本土青训与位置覆盖。',
  };
}

/** 跨关俱乐部增量：真实签约、绝对剩余预算、返工次数。 */
export function buildTransfersClubPatch(state: TransfersState): ClubPatch {
  const signings: ClubSigning[] = signedPlayers(state).map((player) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    fee: Math.max(0, Math.round(((player.paidFee ?? player.askingPrice) / 100) * 10) / 10),
    wage: player.wage,
    homegrown: player.homegrown,
  }));
  return {
    signings,
    transferBudget: Math.max(0, Math.round((state.budget / 100) * 10) / 10),
    wageBudget: Math.max(0, state.wage),
    addFailures: reworkCount(state),
  };
}

/* ==========================================================================
   存档恢复
   ========================================================================== */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function reviveScoutTargets(raw: unknown): ClubScoutCandidate[] | null {
  if (!Array.isArray(raw) || raw.length > SCOUT_TARGETS_READ_MAX) return null;
  const result: ClubScoutCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const data = item as Record<string, unknown>;
    if (typeof data.id !== 'string' || !data.id) return null;
    if (typeof data.name !== 'string' || !data.name) return null;
    if (typeof data.position !== 'string' || !data.position) return null;
    if (typeof data.region !== 'string') return null;
    if (!isFiniteNumber(data.knowledge)) return null;
    result.push({
      id: data.id,
      name: data.name,
      position: data.position,
      region: data.region,
      knowledge: Math.min(100, Math.max(0, Math.round(data.knowledge))),
    });
  }
  return result;
}

function revivePlayer(raw: unknown, scoutTargets: ClubScoutCandidate[]): TransferPlayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const isScout = typeof data.id === 'string' && data.id.startsWith('scout-');
  const seed = isScout ? undefined : PLAYER_SEEDS.find((item) => item.id === data.id);
  const target = isScout ? scoutTargets.find((item) => `scout-${item.id}` === data.id) : undefined;
  if (!seed && !target) return null;
  if (typeof data.name !== 'string' || typeof data.position !== 'string') return null;
  if (!isFiniteNumber(data.valuation) || !isFiniteNumber(data.askingPrice)) return null;
  if (!isFiniteNumber(data.wage) || !isFiniteNumber(data.agentFee) || !isFiniteNumber(data.rivalInterest)) return null;
  if (data.status !== 'available' && data.status !== 'signed' && data.status !== 'lost') return null;
  if (data.signedRound !== null && !isFiniteNumber(data.signedRound)) return null;
  if (data.lostRound !== null && !isFiniteNumber(data.lostRound)) return null;
  if (data.paidFee !== null && !isFiniteNumber(data.paidFee)) return null;
  if (isScout) {
    if (data.source !== 'scout') return null;
    if (!isFiniteNumber(data.knowledge)) return null;
  } else if (data.source !== 'window') {
    return null;
  }
  return {
    id: data.id as string,
    name: data.name,
    position: data.position,
    valuation: data.valuation,
    askingPrice: Math.max(1, data.askingPrice),
    wage: data.wage,
    agentFee: data.agentFee,
    homegrown:
      typeof data.homegrown === 'boolean' ? data.homegrown : seed ? seed.homegrown : target?.region === 'local',
    paidFee: data.paidFee as number | null,
    rivalInterest: Math.min(RIVAL_HIJACK_AT, Math.max(0, data.rivalInterest)),
    status: data.status,
    signedRound: data.signedRound as number | null,
    lostRound: data.lostRound as number | null,
    source: isScout ? 'scout' : 'window',
    knowledge: isScout ? Math.min(100, Math.max(0, Math.round(data.knowledge as number))) : undefined,
    scoutRegionLabel: isScout
      ? typeof data.scoutRegionLabel === 'string'
        ? data.scoutRegionLabel
        : target
          ? SCOUT_REGION_LABELS[target.region] ?? '球探室报告'
          : undefined
      : undefined,
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
  if (data.version !== TRANSFER_STATE_VERSION) return null;
  if (!isPhase(data.phase)) return null;
  if (data.mode !== 'normal' && data.mode !== 'showcase') return null;
  if (!isRngState(data.rng)) return null;
  const rng = reviveRng(data.rng);
  const eventLog = reviveEventLog(data.eventLog);
  if (!eventLog) return null;
  const scoutTargets = reviveScoutTargets(data.scoutTargets);
  if (!scoutTargets) return null;
  if (!Array.isArray(data.players)) return null;
  const expectedExtraCount = data.windowStarted
    ? Math.min(scoutTargets.length, SCOUT_TARGETS_ADD_MAX)
    : 0;
  if (data.players.length !== PLAYER_SEEDS.length + expectedExtraCount) return null;
  const players: TransferPlayer[] = [];
  for (const item of data.players) {
    const player = revivePlayer(item, scoutTargets);
    if (!player) return null;
    players.push(player);
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) return null;
  const baseIds = new Set(players.filter((player) => player.source === 'window').map((player) => player.id));
  if (baseIds.size !== PLAYER_SEEDS.length || PLAYER_SEEDS.some((seed) => !baseIds.has(seed.id))) return null;
  if (!data.modules || typeof data.modules !== 'object') return null;
  const modulesRaw = data.modules as Record<string, unknown>;
  const modules: TransferModules = { budget: false, negotiation: false, galaxy: false, infiniteWait: false };
  for (const id of TRANSFER_MODULE_IDS) {
    if (typeof modulesRaw[id] !== 'boolean') return null;
    modules[id] = modulesRaw[id] as boolean;
  }
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
  if (!isFiniteNumber(data.verifyAttempt) || data.verifyAttempt < 1) return null;
  if (!isFiniteNumber(data.startTransferBudget) || data.startTransferBudget < 0) return null;
  if (!isFiniteNumber(data.startWageBudget) || data.startWageBudget < 0) return null;
  if (!isFiniteNumber(data.clubFailures) || data.clubFailures < 0) return null;
  if (!isFiniteNumber(data.budget) || data.budget < 0) return null;
  if (!isFiniteNumber(data.wage) || data.wage < 0) return null;
  if (!isFiniteNumber(data.seed)) return null;

  return {
    version: TRANSFER_STATE_VERSION,
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
    modules,
    verifyAttempt: Math.floor(data.verifyAttempt),
    startTransferBudget: data.startTransferBudget,
    startWageBudget: data.startWageBudget,
    clubFailures: Math.floor(data.clubFailures),
    scoutTargets,
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
  { label: '转会预算', value: '从俱乐部剩余转会预算开始；转会费 + 经纪人佣金都从这里扣' },
  { label: '周薪空间', value: '从俱乐部剩余周薪空间开始；签约同时占用周薪' },
  { label: '返工成本', value: `每次未达成后重新配置，俱乐部承担 ${formatFee(REWORK_COST)} 谈判/经纪成本（最低 0）` },
  { label: '窗口轮次', value: `${TRANSFER_ROUNDS} 轮，每轮只能报价 1 人或者等待 1 人` },
  { label: '低价报价', value: '支付要价 90%，对手兴趣 +30；兴趣 ≥ 50 时会被拒绝' },
  { label: '正常报价', value: '支付当前要价；兴趣 ≥ 80 时会被拒绝' },
  { label: '高价报价', value: '支付要价 110%，保证成交；对手兴趣 +5' },
  { label: '等待', value: '对手兴趣 +20，要价下降 10%（最后一轮不再下降）' },
  { label: '截胡', value: `每轮末未签约目标兴趣 +${RIVAL_ROUND_DRIFT}，达到 ${RIVAL_HIJACK_AT} 永久失去` },
];

export const TRANSFER_FAULT_NOTE =
  '没有预算、工资空间与竞争，报价只是点击按钮：签下谁、签下几个人都不会带来任何代价。';
