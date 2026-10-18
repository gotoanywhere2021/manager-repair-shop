/**
 * 毕业关《赛季名单》的纯规则层。
 *
 * 把四个系统拼进同一份名单：
 * - 双形态战术：有球 / 无球两套形态 + 一个比赛阶段决策；
 * - 球探网络：2 名球探派往 3 个区域，1 轮考察，知识度决定报告精度；
 * - 转会谈判：预算与工资空间内签下 4 人；
 * - 阵容注册：25 人上限、本土青训名额、位置覆盖、工资空间。
 *
 * 这一层不依赖 React / DOM，状态可 JSON 序列化，随机只用 engine/rng.ts。
 * 毕业关不评「高分」：只记录三项目标是否有规则与真实操作证据。
 */

import { createRng, isRngState, nextInt, reviveRng } from '../../engine/rng';
import type { RngState } from '../../engine/rng';
import { recordEvent } from '../../engine/events';
import { createEvidence } from '../../engine/types';
import type {
  ClubPatch,
  ClubSeasonReport,
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
   注册规则与转会常量：界面与测试共用同一份来源。
   ========================================================================== */

/** 存档结构版本；v4 增加跨关俱乐部预算、已签约球员与返工成本。 */
export const SQUAD_STATE_VERSION = 3;

/** 名单人数上限。 */
export const SQUAD_LIMIT = 25;
/** 本土青训最少人数。 */
export const YOUTH_MIN = 8;
/** 各位置最低覆盖人数。 */
export const POSITION_MIN = { GK: 2, DF: 6, MF: 6, FW: 4 } as const;
/** 默认周薪空间，单位千欧/周（club 未定义时使用）。 */
export const WAGE_SPACE = 320;
/** 现有 21 人阵容的基础周薪，单位千欧/周。 */
export const BASE_WAGE = 240;
/** 默认转会预算，单位万欧（4200 万欧 = €42M；club 未定义时使用）。 */
export const TRANSFER_BUDGET = 4200;
/** 每次返工由俱乐部承担的紧急处理成本：100 万欧 = €1M。 */
export const REWORK_COST = 100;
/** 「全权交给经纪人」模块：预算与工资上限各扣 10%。 */
export const AGENT_BUDGET_RATIO = 0.9;
export const AGENT_WAGE_RATIO = 0.9;
/** 现有阵容固定为 21 人，签下 4 人正好 25 人（无跨关引援时）。 */
export const BASE_SQUAD_TOTAL = 21;
/** 无跨关引援时需要签下 4 人。 */
export const REQUIRED_SIGNINGS = 4;
/** 展示短局需要签下 2 人。 */
export const REQUIRED_SIGNINGS_FAST = 2;
/** 球探数量。 */
export const SCOUT_COUNT = 2;

export type SquadPosition = keyof typeof POSITION_MIN;
export type RegionId = 'east' | 'plateau' | 'port';
export type SquadStep = 'scout' | 'transfer' | 'tactics' | 'registration';
export type SquadModuleId =
  | 'tactics'
  | 'scouting'
  | 'transfers'
  | 'registration'
  | 'ignoreRegistration'
  | 'agent';
export type SquadModules = Record<SquadModuleId, boolean>;

export const SQUAD_MODULE_IDS: SquadModuleId[] = [
  'tactics',
  'scouting',
  'transfers',
  'registration',
  'ignoreRegistration',
  'agent',
];

export const POSITION_LABELS: Record<SquadPosition, string> = {
  GK: '门将',
  DF: '后卫',
  MF: '中场',
  FW: '前锋',
};

export const POSITIONS: SquadPosition[] = ['GK', 'DF', 'MF', 'FW'];

/**
 * 把其他关卡提交的位置字符串映射到本关位置。
 * 既接受 GK/DF/MF/FW，也接受转会窗使用的中文位置（门将 / 中卫 / 边锋 等）。
 */
export function mapClubPosition(position: string): SquadPosition {
  const raw = position.trim();
  if ((POSITIONS as string[]).includes(raw)) return raw as SquadPosition;
  if (/门将|守门/.test(raw)) return 'GK';
  if (/后卫|中卫|边卫|DF/i.test(raw)) return 'DF';
  if (/中场|后腰|前腰|边前卫|MF/i.test(raw)) return 'MF';
  if (/前锋|边锋|中锋|前场|FW/i.test(raw)) return 'FW';
  return 'MF';
}

/** 把俱乐部已签约球员转成本关的注册名单成员。 */
export function inheritedRosterPlayers(state: SquadState): { signing: ClubSigning; position: SquadPosition }[] {
  return state.inheritedSignings.map((signing) => ({
    signing,
    position: mapClubPosition(signing.position),
  }));
}

export interface BaseSquadPlayer {
  id: string;
  name: string;
  position: SquadPosition;
  youth: boolean;
}

/** 现有 21 人阵容的虚构球员名单：界面用它做分组 / 槽位展示，注册检查从同一份名单推导。 */
export const BASE_SQUAD_PLAYERS: BaseSquadPlayer[] = [
  { id: 'base-gk-1', name: '韩铮', position: 'GK', youth: true },
  { id: 'base-gk-2', name: '鲁迪', position: 'GK', youth: false },
  { id: 'base-df-1', name: '白岩', position: 'DF', youth: true },
  { id: 'base-df-2', name: '林川', position: 'DF', youth: true },
  { id: 'base-df-3', name: '陈戍', position: 'DF', youth: false },
  { id: 'base-df-4', name: '卡尔松', position: 'DF', youth: false },
  { id: 'base-df-5', name: '扎伊德', position: 'DF', youth: false },
  { id: 'base-mf-1', name: '阿贵', position: 'MF', youth: true },
  { id: 'base-mf-2', name: '高天', position: 'MF', youth: true },
  { id: 'base-mf-3', name: '徐朗', position: 'MF', youth: true },
  { id: 'base-mf-4', name: '木村', position: 'MF', youth: false },
  { id: 'base-mf-5', name: '韦斯', position: 'MF', youth: false },
  { id: 'base-mf-6', name: '迪亚洛', position: 'MF', youth: false },
  { id: 'base-mf-7', name: '小野', position: 'MF', youth: false },
  { id: 'base-fw-1', name: '何塞', position: 'FW', youth: true },
  { id: 'base-fw-2', name: '库珀', position: 'FW', youth: false },
  { id: 'base-fw-3', name: '邓肯', position: 'FW', youth: false },
  { id: 'base-fw-4', name: '伊力', position: 'FW', youth: false },
  { id: 'base-fw-5', name: '拉赫', position: 'FW', youth: false },
  { id: 'base-fw-6', name: '马丁', position: 'FW', youth: false },
  { id: 'base-fw-7', name: '宁远', position: 'FW', youth: false },
];

/** 现有阵容的分位置人数，直接由名单推导，保证界面槽位与注册检查同源。 */
export const BASE_SQUAD_COUNTS: Record<SquadPosition, number> = {
  GK: BASE_SQUAD_PLAYERS.filter((player) => player.position === 'GK').length,
  DF: BASE_SQUAD_PLAYERS.filter((player) => player.position === 'DF').length,
  MF: BASE_SQUAD_PLAYERS.filter((player) => player.position === 'MF').length,
  FW: BASE_SQUAD_PLAYERS.filter((player) => player.position === 'FW').length,
};
export const BASE_SQUAD_YOUTH = BASE_SQUAD_PLAYERS.filter((player) => player.youth).length;


/* ==========================================================================
   候选、区域、战术预设与微教学方案
   ========================================================================== */

export interface CandidateSeed {
  id: string;
  name: string;
  position: SquadPosition;
  region: RegionId;
  /** 转会费，单位万欧。 */
  transferFee: number;
  /** 周薪，单位千欧。 */
  wage: number;
  /** 是否本土青训。 */
  youth: boolean;
  /** 基础能力，真实值会按种子做 ±2 的抖动。 */
  baseAbility: number;
}

/** 6 名候选全部虚构；能力真实值藏在报告区间后面。 */
export const CANDIDATE_SEEDS: CandidateSeed[] = [
  { id: 'adili', name: '阿迪力', position: 'DF', region: 'east', transferFee: 1200, wage: 24, youth: true, baseAbility: 72 },
  { id: 'gaoqiao', name: '高桥凌', position: 'MF', region: 'plateau', transferFee: 800, wage: 18, youth: false, baseAbility: 76 },
  { id: 'shenzhou', name: '沈舟', position: 'FW', region: 'port', transferFee: 1500, wage: 30, youth: true, baseAbility: 78 },
  { id: 'zhouyuan', name: '周原', position: 'DF', region: 'east', transferFee: 950, wage: 16, youth: false, baseAbility: 69 },
  { id: 'luoke', name: '罗克', position: 'GK', region: 'port', transferFee: 600, wage: 14, youth: false, baseAbility: 73 },
  { id: 'limu', name: '李沐', position: 'MF', region: 'plateau', transferFee: 700, wage: 15, youth: false, baseAbility: 71 },
];

export interface SquadRegion {
  id: RegionId;
  name: string;
  description: string;
  candidateIds: string[];
}

export const REGIONS: SquadRegion[] = [
  { id: 'east', name: '东海岸联赛', description: '后卫储备较多，本土青训比例高。', candidateIds: ['adili', 'zhouyuan'] },
  { id: 'plateau', name: '高原联赛', description: '中场球员为主，身体与技术较均衡。', candidateIds: ['gaoqiao', 'limu'] },
  { id: 'port', name: '港口联赛', description: '前锋与门将的市场，身价跨度大。', candidateIds: ['shenzhou', 'luoke'] },
];

export interface TacticPreset {
  id: string;
  name: string;
  description: string;
}

export const POSSESSION_PRESETS: TacticPreset[] = [
  { id: '433-attack', name: '4-3-3 进攻', description: '边路拉开、边后卫套上，控球时压上更多人。' },
  { id: '4231-balance', name: '4-2-3-1 平衡', description: '双后腰保护，前场三人负责创造。' },
  { id: '352-control', name: '3-5-2 控球', description: '三中卫出球，翼卫提供宽度。' },
];

export const OUT_PRESETS: TacticPreset[] = [
  { id: '442-block', name: '4-4-2 中位块', description: '两条线保持紧凑，把对手逼向边路。' },
  { id: '532-low', name: '5-3-2 低位块', description: '五后卫保护禁区，放弃高位压迫。' },
  { id: '433-press', name: '4-3-3 高位压迫', description: '前场三人抢第一点，身后空间变大。' },
];

export const MATCH_DECISIONS: TacticPreset[] = [
  { id: 'keep-press', name: '继续高位压迫', description: '争取第二个进球，但身后空间继续暴露。' },
  { id: 'switch-block', name: '回到中位块，换下边锋', description: '收紧中路，接受控球减少。' },
  { id: 'park-bus', name: '五后卫死守', description: '把比分守住，但要承受连续进攻。' },
];

/** 把上一关战术板的形态 id 映射到本关的形态预设；没有对应时返回 null。 */
export function mapPossessionPreset(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = POSSESSION_PRESETS.find((preset) => preset.id === value);
  if (direct) return direct.id;
  const table: Record<string, string> = {
    '4-3-3': '433-attack',
    '4-2-3-1': '4231-balance',
    '3-2-5': '352-control',
  };
  return table[value] ?? null;
}

/** 把上一关战术板的形态 id 映射到本关的无球形态预设；没有对应时返回 null。 */
export function mapOutPreset(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = OUT_PRESETS.find((preset) => preset.id === value);
  if (direct) return direct.id;
  const table: Record<string, string> = {
    '4-4-2-mid': '442-block',
    '5-3-2-low': '532-low',
    '4-1-4-1': '433-press',
  };
  return table[value] ?? null;
}

function tacticsPresetFromClub(club: ClubState | undefined): { possessionId: string | null; outId: string | null } {
  return {
    possessionId: mapPossessionPreset(club?.tactics?.possessionShape),
    outId: mapOutPreset(club?.tactics?.outOfPossessionShape),
  };
}

export interface MicroList {
  id: 'a' | 'b';
  name: string;
  description: string;
  total: number;
  counts: Record<SquadPosition, number>;
  youth: number;
}

/** 微教学里的两份 25 人名单：一份只堆同位置，一份满足注册规则。 */
export const MICRO_LISTS: MicroList[] = [
  {
    id: 'a',
    name: '方案 A · 只堆同位置',
    description: '25 名球员全是前锋，看起来全是攻击手。',
    total: 25,
    counts: { GK: 0, DF: 0, MF: 0, FW: 25 },
    youth: 3,
  },
  {
    id: 'b',
    name: '方案 B · 满足注册规则',
    description: '门将 2、后卫 7、中场 8、前锋 8，本土青训 9 人。',
    total: 25,
    counts: { GK: 2, DF: 7, MF: 8, FW: 8 },
    youth: 9,
  },
];

export interface RegistrationItem {
  id: string;
  label: string;
  actual: number;
  required: number;
  passed: boolean;
  skipped?: boolean;
  detail?: string;
}

/** 微教学用的检查：只检查人数、青训与位置覆盖。 */
export function checkMicroList(list: MicroList): RegistrationItem[] {
  const items: RegistrationItem[] = [
    { id: 'size', label: '人数上限', actual: list.total, required: SQUAD_LIMIT, passed: list.total <= SQUAD_LIMIT },
    { id: 'youth', label: '本土青训', actual: list.youth, required: YOUTH_MIN, passed: list.youth >= YOUTH_MIN },
  ];
  POSITIONS.forEach((position) => {
    items.push({
      id: position.toLowerCase(),
      label: POSITION_LABELS[position],
      actual: list.counts[position],
      required: POSITION_MIN[position],
      passed: list.counts[position] >= POSITION_MIN[position],
    });
  });
  return items;
}

/* ==========================================================================
   模块退化说明：关闭模块时立刻显示会发生什么。
   ========================================================================== */

export const MODULE_DEGRADE_NOTES: Record<SquadModuleId, string> = {
  tactics: '关闭后只有一套站位：无法设置两套形态，比赛阶段被边路反复打穿（目标一不会达成）。',
  scouting: '关闭后所有候选能力瞬间完全公开，知识度恒为 100；没有「知识度不足的报告」（目标二不会达成）。',
  transfers: '关闭后预算与工资空间不再限制签约，报价失去代价；注册检查仍会算周薪总额。',
  registration: '关闭后不做人数、青训与位置覆盖检查，名单直接通过；但目标三不会达成。',
  ignoreRegistration:
    '无视注册规则：跳过全部注册检查，名单直接放行；看起来省事，但目标三永远无法达成，也看不到真实缺口。',
  agent:
    '全权交给经纪人：预算与工资上限各扣 10%，签约时不再检查预算与工资；但注册仍按缩减后的工资上限检查，很可能会失败。',
};

export interface SquadModuleInfo {
  id: SquadModuleId;
  name: string;
  englishName: string;
  description: string;
  sideEffect: string;
  kind: 'correct' | 'risky';
}

/** 两个错误 / 有副作用模块的完整文案；正确模块的文案来自关卡定义。 */
export const WRONG_MODULE_INFO: Record<'ignoreRegistration' | 'agent', SquadModuleInfo> = {
  ignoreRegistration: {
    id: 'ignoreRegistration',
    name: '无视注册规则',
    englishName: 'Ignore Registration',
    description: '把注册检查从流程里拿掉，名单直接放行，不再看人数、青训与位置。',
    sideEffect: '跳过 25 人上限、青训、位置覆盖与工资检查；名单能交上去，但目标三永远无法达成。',
    kind: 'risky',
  },
  agent: {
    id: 'agent',
    name: '全权交给经纪人',
    englishName: 'Agent in Charge',
    description: '让经纪人包办所有谈判：签约不再被预算与工资拦住，也没有竞争。',
    sideEffect: '预算与工资上限各扣 10%（€42M→€37.8M、€320k→€288k）；注册仍按缩减后的工资上限检查，通常会失败。',
    kind: 'risky',
  },
};

export const SQUAD_RULE_LINES: { label: string; value: string }[] = [
  { label: '名单人数', value: `${BASE_SQUAD_TOTAL} 名现有球员 + 最多 ${SQUAD_LIMIT - BASE_SQUAD_TOTAL} 名新援，上限 ${SQUAD_LIMIT} 人` },
  { label: '本土青训', value: `至少 ${YOUTH_MIN} 人；现有阵容已有 ${BASE_SQUAD_YOUTH} 人` },
  { label: '位置覆盖', value: `门将 ≥${POSITION_MIN.GK}、后卫 ≥${POSITION_MIN.DF}、中场 ≥${POSITION_MIN.MF}、前锋 ≥${POSITION_MIN.FW}` },
  { label: '工资空间', value: `周薪总额 ≤ €${WAGE_SPACE}k/周；现有阵容占 €${BASE_WAGE}k/周` },
  { label: '转会预算', value: `€${TRANSFER_BUDGET / 100}M，转会费从预算扣除` },
  { label: '球探', value: `${SCOUT_COUNT} 名球探、3 个区域、1 轮考察；知识度越高区间越窄，但永远不会直接给出精确值` },
];

/* ==========================================================================
   反思题 / 反事实题
   ========================================================================== */

export const COUNTERFACTUAL_OPTIONS: QuizOption[] = [
  {
    id: 'move-out',
    label: '不能直接通过：25 个名额已经满了，必须先移出 1 名非青训球员，才能再签 1 名本土青训。',
  },
  { id: 'separate', label: '能：青训名额和总人数分开计算，可以报到 26 人。' },
  { id: 'free-slot', label: '能：只要新球员是本土青训，就不占 25 人名额。' },
  { id: 'wage-only', label: '不能：因为工资空间一定会超，和人数没有关系。' },
];

export const COUNTERFACTUAL_CORRECT_ID = 'move-out';

export const COUNTERFACTUAL_EXPLANATIONS: Record<string, string> = {
  'move-out':
    '正确：25 人是硬上限。青训名额再缺，也要先腾出 1 个人数名额；青训名额和人数上限是两个独立约束，必须同时满足。',
  separate: '青训名额不是额外名额：25 人上限对所有人一视同仁，凑青训也要先腾出位置。',
  'free-slot': '本土青训身份只影响青训名额，不会让人数上限失效。',
  'wage-only': '工资空间是另一个约束，但这里的障碍是人数已经到 25 人上限；先解决名额，再算工资。',
};

export interface ReflectionOption {
  id: string;
  label: string;
  feedback: string;
}

/** 反思题没有唯一正确答案：每条解释都给出针对性反馈。 */
export const REFLECTION_OPTIONS: ReflectionOption[] = [
  {
    id: 'slots',
    label: '因为每签一个人都在同时占用人数、青训、位置与工资名额，转会目标从「选最强」变成了「补最缺」。',
    feedback: '这条解释抓住的是组合约束：名单不是球员列表的堆叠，而是一张同时被四个规则检查的表。',
  },
  {
    id: 'youth',
    label: '因为青训名额是硬指标，有时必须为了配额放弃一名更强的球员。',
    feedback: '这条解释抓住了配额带来的取舍：注册规则让「能力最高」不再是唯一标准，补上青训缺口本身就有价值。',
  },
  {
    id: 'positions',
    label: '因为位置覆盖会被检查，所以即使某个位置已经很强，也不能把最后一个名额再堆在那里。',
    feedback: '这条解释抓住了位置覆盖：注册规则把「收集强球员」变成了「拼一张能过关的名单」。',
  },
  {
    id: 'budget',
    label: '因为预算与工资空间会在签约和注册两处同时生效，贵球员会挤压后面补缺的空间。',
    feedback: '这条解释抓住了代价的传导：钱花在哪里，决定了名单最后还能不能补齐缺口。',
  },
];

/* ==========================================================================
   状态类型
   ========================================================================== */

export interface SquadCandidate {
  id: string;
  name: string;
  position: SquadPosition;
  region: RegionId;
  transferFee: number;
  wage: number;
  youth: boolean;
  ability: number;
}

export interface ScoutsState {
  assignments: Record<RegionId, number>;
  confirmed: boolean;
}

export interface TacticsState {
  possessionId: string | null;
  outId: string | null;
  decisionId: string | null;
  confirmed: boolean;
  matchReport: string | null;
}

export interface RegistrationResult {
  enabled: boolean;
  passed: boolean;
  /** 是否因为「无视注册规则」而跳过了检查。 */
  skippedByIgnore: boolean;
  items: RegistrationItem[];
  total: number;
  youth: number;
  counts: Record<SquadPosition, number>;
  wage: number;
  /** 当前模块下实际生效的工资上限（经纪人模块会砍 10%）。 */
  wageCap: number;
  /** 当前模块下实际生效的预算上限（经纪人模块会砍 10%）。 */
  budgetCap: number;
  budgetUsed: number;
  note: string;
}

export interface SquadState {
  version: typeof SQUAD_STATE_VERSION;
  phase: LevelPhase;
  mode: GameMode;
  fastPlay: boolean;
  seed: number;
  rng: RngState;
  eventLog: EventLogEntry[];
  evidence: Evidence;
  modules: SquadModules;
  /** 上一关（转会窗）已经签下、直接进入本次名单的球员。 */
  inheritedSignings: ClubSigning[];
  candidates: SquadCandidate[];
  microChecks: { a: boolean; b: boolean };
  microTaught: boolean;
  flowStarted: boolean;
  step: SquadStep;
  scouts: ScoutsState;
  signings: string[];
  round: number;
  tactics: TacticsState;
  /** 从上一关战术板带入的默认形态；重新开始名单流程时恢复到这套默认。 */
  tacticsPreset: { possessionId: string | null; outId: string | null };
  registration: RegistrationResult | null;
  counterfactualCorrect: boolean;
  counterfactualAnswered: boolean;
  reflectionChoice: string | null;
  reflectionConfirmed: boolean;
  skippedReflection: boolean;
  restarts: number;
  /** 本关开始时可用的俱乐部转会预算，单位万欧。 */
  startTransferBudget: number;
  /** 本关开始时可用的俱乐部周薪空间，单位千欧/周。 */
  startWageRoom: number;
  /** 是否连接了正常模式的跨关俱乐部状态。 */
  clubConnected: boolean;
  /** 进入本关时俱乐部历史上的返工次数（仅展示）。 */
  clubFailures: number;
}

export interface SquadActionResult {
  state: SquadState;
  ok: boolean;
  reason?: string;
  correct?: boolean;
}

export interface CreateSquadOptions {
  mode: GameMode;
  seed: number;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
  /** 正常模式下的跨关俱乐部状态；展示模式为 undefined。 */
  club?: ClubState;
}

/* ==========================================================================
   基础派生
   ========================================================================== */

/** 无跨关引援时正常 4 人 / 短局 2 人；已从转会窗签下的人会直接占掉名单名额。 */
export function requiredSignings(state: SquadState): number {
  const base = state.fastPlay ? REQUIRED_SIGNINGS_FAST : REQUIRED_SIGNINGS;
  return Math.max(0, base - state.inheritedSignings.length);
}

/** 把万欧格式化成 €12M / €9.5M。 */
export function formatSquadFee(wan: number): string {
  const millions = wan / 100;
  return `€${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}M`;
}

/** 把千欧/周格式化成 €320k/周。 */
export function formatSquadWage(kilo: number): string {
  return `€${kilo}k/周`;
}

export function emptyScouts(): ScoutsState {
  return { assignments: { east: 0, plateau: 0, port: 0 }, confirmed: false };
}

/** 空战术状态；可带入上一关战术板的默认形态（不自动确认，比赛决策仍需自己选）。 */
export function emptyTactics(prefill?: { possessionId: string | null; outId: string | null }): TacticsState {
  return {
    possessionId: prefill?.possessionId ?? null,
    outId: prefill?.outId ?? null,
    decisionId: null,
    confirmed: false,
    matchReport: null,
  };
}

export function candidateById(state: SquadState, id: string): SquadCandidate | undefined {
  return state.candidates.find((candidate) => candidate.id === id);
}

export function signedCandidates(state: SquadState): SquadCandidate[] {
  return state.signings
    .map((id) => candidateById(state, id))
    .filter((candidate): candidate is SquadCandidate => Boolean(candidate));
}

export function feeUsed(state: SquadState): number {
  return signedCandidates(state).reduce((total, candidate) => total + candidate.transferFee, 0);
}

/** 本关已经发生的返工次数（每次「回到维修台重新配置」+1）。 */
export function reworkCount(state: SquadState): number {
  return Math.max(0, state.restarts);
}

/** 俱乐部因返工累计承担的紧急处理成本，单位万欧。 */
export function reworkCostPaid(state: SquadState): number {
  return reworkCount(state) * REWORK_COST;
}

/** 扣除返工成本后的转会预算基数（未应用经纪人模块）。 */
export function budgetBase(state: SquadState): number {
  return Math.max(0, state.startTransferBudget - reworkCostPaid(state));
}

/** 当前模块下实际生效的转会预算上限；「全权交给经纪人」会再砍 10%。 */
export function budgetCap(state: SquadState): number {
  return state.modules.agent ? Math.floor(budgetBase(state) * AGENT_BUDGET_RATIO) : budgetBase(state);
}

/** 不受经纪人模块影响的工资基数：俱乐部模式 = 现有周薪 + 俱乐部剩余空间。 */
export function wageBase(state: SquadState): number {
  return state.clubConnected ? BASE_WAGE + state.startWageRoom : WAGE_SPACE;
}

/** 当前模块下实际生效的周薪空间上限；「全权交给经纪人」会再砍 10%。 */
export function wageCap(state: SquadState): number {
  return state.modules.agent ? Math.floor(wageBase(state) * AGENT_WAGE_RATIO) : wageBase(state);
}

export function remainingBudget(state: SquadState): number {
  return budgetCap(state) - feeUsed(state);
}

export function wageUsed(state: SquadState): number {
  return BASE_WAGE + signedCandidates(state).reduce((total, candidate) => total + candidate.wage, 0);
}

export function remainingWage(state: SquadState): number {
  return wageCap(state) - wageUsed(state);
}

export function youthCount(state: SquadState): number {
  const inheritedYouth = inheritedRosterPlayers(state).filter((entry) => entry.signing.homegrown).length;
  return BASE_SQUAD_YOUTH + inheritedYouth + signedCandidates(state).filter((candidate) => candidate.youth).length;
}

export function squadCounts(state: SquadState): Record<SquadPosition, number> {
  const counts: Record<SquadPosition, number> = {
    GK: BASE_SQUAD_COUNTS.GK,
    DF: BASE_SQUAD_COUNTS.DF,
    MF: BASE_SQUAD_COUNTS.MF,
    FW: BASE_SQUAD_COUNTS.FW,
  };
  inheritedRosterPlayers(state).forEach((entry) => {
    counts[entry.position] += 1;
  });
  signedCandidates(state).forEach((candidate) => {
    counts[candidate.position] += 1;
  });
  return counts;
}

export function squadTotal(state: SquadState): number {
  return BASE_SQUAD_TOTAL + state.inheritedSignings.length + state.signings.length;
}

export interface RosterSlotPlayer {
  id: string;
  name: string;
  youth: boolean;
  signed: boolean;
  /** 是否来自上一关转会窗。 */
  inherited: boolean;
}

export interface RosterGroup {
  position: SquadPosition;
  label: string;
  min: number;
  count: number;
  passed: boolean;
  players: RosterSlotPlayer[];
  /** 距离最低覆盖还差几个位置名额。 */
  gapToMin: number;
}

/** 名单分组 / 槽位展示：现有 21 人 + 转会窗引援 + 本关新援按位置分组，缺口一眼可见。 */
export function rosterGroups(state: SquadState): RosterGroup[] {
  const signed = signedCandidates(state);
  const inherited = inheritedRosterPlayers(state);
  return POSITIONS.map((position) => {
    const basePlayers: RosterSlotPlayer[] = BASE_SQUAD_PLAYERS.filter((player) => player.position === position).map(
      (player) => ({ id: player.id, name: player.name, youth: player.youth, signed: false, inherited: false }),
    );
    const inheritedPlayers: RosterSlotPlayer[] = inherited
      .filter((entry) => entry.position === position)
      .map((entry) => ({
        id: entry.signing.id,
        name: entry.signing.name,
        youth: entry.signing.homegrown,
        signed: true,
        inherited: true,
      }));
    const signedPlayersList: RosterSlotPlayer[] = signed
      .filter((candidate) => candidate.position === position)
      .map((candidate) => ({ id: candidate.id, name: candidate.name, youth: candidate.youth, signed: true, inherited: false }));
    const players = [...basePlayers, ...inheritedPlayers, ...signedPlayersList];
    return {
      position,
      label: POSITION_LABELS[position],
      min: POSITION_MIN[position],
      count: players.length,
      passed: players.length >= POSITION_MIN[position],
      players,
      gapToMin: Math.max(0, POSITION_MIN[position] - players.length),
    };
  });
}

export function scoutAssignmentsTotal(state: SquadState): number {
  return (Object.values(state.scouts.assignments) as number[]).reduce((total, value) => total + value, 0);
}

/** 某个区域的知识度：关掉球探网络后退化为 100（信息全开）。 */
export function regionKnowledge(state: SquadState, regionId: RegionId): number {
  if (!state.modules.scouting) return 100;
  const count = state.scouts.assignments[regionId] ?? 0;
  if (count <= 0) return 0;
  if (count === 1) return 70;
  return 92;
}

export interface AbilityReport {
  knowledge: number;
  kind: 'exact' | 'range' | 'none';
  text: string;
}

/** 候选能力报告：知识度不足时只给区间，永远不给精确值；球探网络关闭后才会全公开。 */
export function abilityReport(state: SquadState, candidate: SquadCandidate): AbilityReport {
  if (!state.modules.scouting) {
    return { knowledge: 100, kind: 'exact', text: `能力 ${candidate.ability}（球探网络未启用：信息完全公开）` };
  }
  const knowledge = regionKnowledge(state, candidate.region);
  if (knowledge <= 0) {
    return { knowledge, kind: 'none', text: '未考察：没有能力报告，只能看到身价、周薪与位置。' };
  }
  const halfWidth = knowledge >= 90 ? 2 : 6;
  const low = Math.max(1, candidate.ability - halfWidth);
  const high = candidate.ability + halfWidth;
  return {
    knowledge,
    kind: 'range',
    text: `能力 ${low}–${high}（知识度 ${knowledge}，这是区间，不是精确值）`,
  };
}

/* ==========================================================================
   注册检查与目标证据
   ========================================================================== */

function computeRegistrationItems(state: SquadState): RegistrationItem[] {
  const counts = squadCounts(state);
  const total = squadTotal(state);
  const youth = youthCount(state);
  const wage = wageUsed(state);
  const cap = wageCap(state);
  return [
    { id: 'size', label: '25 人上限', actual: total, required: SQUAD_LIMIT, passed: total <= SQUAD_LIMIT },
    { id: 'youth', label: '本土青训名额', actual: youth, required: YOUTH_MIN, passed: youth >= YOUTH_MIN },
    ...POSITIONS.map<RegistrationItem>((position) => ({
      id: position.toLowerCase(),
      label: `位置覆盖 · ${POSITION_LABELS[position]}`,
      actual: counts[position],
      required: POSITION_MIN[position],
      passed: counts[position] >= POSITION_MIN[position],
    })),
    state.fastPlay
      ? {
          id: 'wage',
          label: '周薪空间',
          actual: wage,
          required: cap,
          passed: true,
          skipped: true,
          detail: '演示短局：工资检查从略。',
        }
      : { id: 'wage', label: '周薪空间', actual: wage, required: cap, passed: wage <= cap },
  ];
}

function buildRegistrationResult(
  state: SquadState,
  enabled: boolean,
  skippedByIgnore: boolean,
): RegistrationResult {
  const items = computeRegistrationItems(state);
  const strictPassed = items.every((item) => item.passed);
  const passed = skippedByIgnore ? true : enabled ? strictPassed : true;
  return {
    enabled,
    passed,
    skippedByIgnore,
    items,
    total: squadTotal(state),
    youth: youthCount(state),
    counts: squadCounts(state),
    wage: wageUsed(state),
    wageCap: wageCap(state),
    budgetCap: budgetCap(state),
    budgetUsed: feeUsed(state),
    note: skippedByIgnore
      ? '已启用「无视注册规则」：跳过全部注册检查，名单直接放行；目标三永远无法达成。'
      : enabled
        ? strictPassed
          ? '名单通过全部注册检查。'
          : '名单没有通过注册检查：先看具体缺口，再决定回到维修台重新配置补哪一项。'
        : '注册规则未启用：不检查人数、青训、位置覆盖与工资，名单直接通过。',
  };
}

/** 当前实际生效的注册检查（可能被「无视注册规则」或关闭模块退化）。 */
export function evaluateRegistration(state: SquadState): RegistrationResult {
  const skippedByIgnore = state.modules.ignoreRegistration;
  const enabled = state.modules.registration && !skippedByIgnore;
  return buildRegistrationResult(state, enabled, skippedByIgnore);
}

/** 不受模块开关影响的真实注册检查：用于动态反事实题与「关掉规则会怎样」的对照。 */
export function strictRegistration(state: SquadState): RegistrationResult {
  return buildRegistrationResult(state, true, false);
}

export interface SquadGoal {
  id: 'tactics' | 'scouting' | 'registration';
  title: string;
  achieved: boolean;
  detail: string;
}

function presetName(presets: TacticPreset[], id: string | null): string {
  return presets.find((preset) => preset.id === id)?.name ?? '未设置';
}

export function evaluateGoals(state: SquadState): SquadGoal[] {
  const tacticsAchieved =
    state.modules.tactics &&
    Boolean(state.tactics.possessionId) &&
    Boolean(state.tactics.outId) &&
    Boolean(state.tactics.decisionId) &&
    state.tactics.confirmed;

  const reportSigning = state.signings
    .map((id) => candidateById(state, id))
    .find((candidate): candidate is SquadCandidate => {
      if (!candidate) return false;
      const knowledge = regionKnowledge(state, candidate.region);
      return knowledge > 0 && knowledge < 100;
    });
  const scoutingAchieved = state.modules.scouting && state.scouts.confirmed && Boolean(reportSigning);

  const registration = state.registration;
  const registrationAchieved =
    state.modules.registration &&
    !state.modules.ignoreRegistration &&
    registration !== null &&
    registration.enabled &&
    registration.passed;

  const tacticsDetail = state.modules.tactics
    ? tacticsAchieved
      ? `有球 ${presetName(POSSESSION_PRESETS, state.tactics.possessionId)} / 无球 ${presetName(OUT_PRESETS, state.tactics.outId)} / 第 65 分钟：${presetName(MATCH_DECISIONS, state.tactics.decisionId)}`
      : '双形态战术已启用，但还没有完成有球 / 无球与比赛阶段决策。'
    : '双形态战术未启用，目标一无法达成。';

  const scoutingDetail = state.modules.scouting
    ? reportSigning
      ? `依据知识度 ${regionKnowledge(state, reportSigning.region)} 的报告签下 ${reportSigning.name}。`
      : state.scouts.confirmed
        ? '球探已派遣，但还没有依据「知识度 > 0 且 < 100」的报告签下球员。'
        : '球探系统已启用，但还没有完成 1 轮考察。'
    : '球探网络未启用，所有候选信息完全公开，目标二无法达成。';

  const registrationDetail = state.modules.ignoreRegistration
    ? '已启用「无视注册规则」：注册检查被跳过，名单直接放行，目标三永远无法达成。'
    : state.modules.registration
      ? registration
        ? registration.passed
          ? `人数 ${registration.total}/${SQUAD_LIMIT} · 青训 ${registration.youth}/${YOUTH_MIN} · 位置覆盖与工资均通过。`
          : `未通过：${registration.items
              .filter((item) => !item.passed)
              .map((item) => `${item.label} ${item.actual}/${item.required}`)
              .join('、')}。`
        : '还没有运行注册检查。'
      : '注册规则未启用，名单直接通过，目标三无法达成。';

  return [
    { id: 'tactics', title: '目标一：战术决策', achieved: tacticsAchieved, detail: tacticsDetail },
    { id: 'scouting', title: '目标二：球探报告', achieved: scoutingAchieved, detail: scoutingDetail },
    { id: 'registration', title: '目标三：注册检查', achieved: registrationAchieved, detail: registrationDetail },
  ];
}

export function goalsAllAchieved(state: SquadState): boolean {
  return evaluateGoals(state).every((goal) => goal.achieved);
}

/** 完成 4 名签约（短局 2 名）+ 通过真实注册检查，才构成 operatedMechanic 证据。 */
export function operatedMechanicMet(state: SquadState): boolean {
  const registration = state.registration;
  if (!state.modules.registration || state.modules.ignoreRegistration || registration === null) return false;
  return registration.enabled && registration.passed && state.signings.length >= requiredSignings(state);
}

export function isSquadComplete(state: SquadState): boolean {
  return goalsAllAchieved(state) && operatedMechanicMet(state);
}

/** 还不能归档的完整原因列表：目标未达成 / 签约不足 / 规则被绕过。 */
export function squadArchiveProblems(state: SquadState): string[] {
  const problems: string[] = [];
  if (!state.registration) problems.push('还没有运行注册检查。');
  if (state.modules.ignoreRegistration) problems.push('「无视注册规则」已启用：目标三永远无法达成。');
  for (const goal of evaluateGoals(state)) {
    if (!goal.achieved) problems.push(`${goal.title}未达成：${goal.detail}`);
  }
  if (state.signings.length < requiredSignings(state)) {
    problems.push(`签约人数不足：${state.signings.length} / ${requiredSignings(state)} 人。`);
  }
  return problems;
}

export function squadArchiveBlockedReason(state: SquadState): string | null {
  const problems = squadArchiveProblems(state);
  return problems.length > 0 ? problems[0] : null;
}

/* ==========================================================================
   比赛阶段报告（只作为文字结果，不作为通关分数）
   ========================================================================== */

export function buildMatchReport(state: SquadState): string {
  if (!state.modules.tactics) {
    return '双形态战术未启用：只有一套站位打满全场。进攻时边路人手不足，丢球后两线距离过大，第 70 分钟被对手从边路打成 2 次反击。';
  }
  const possession = presetName(POSSESSION_PRESETS, state.tactics.possessionId);
  const outShape = presetName(OUT_PRESETS, state.tactics.outId);
  const decision = presetName(MATCH_DECISIONS, state.tactics.decisionId);
  return `有球 ${possession} / 无球 ${outShape}。第 65 分钟你选择「${decision}」：比赛阶段出现 2 次由边路回收带来的二次进攻，同时让出 1 次反击机会。结果只用于观察，不作为通关分数。`;
}

/* ==========================================================================
   日志与快照
   ========================================================================== */

function knowledgeText(state: SquadState): string {
  return REGIONS.map((region) => `${region.name} ${regionKnowledge(state, region.id)}`).join(' / ');
}

function flowSnapshot(state: SquadState): EventState {
  return {
    step: state.step,
    signings: state.signings.length,
    budgetUsed: feeUsed(state),
    wageUsed: wageUsed(state),
    total: squadTotal(state),
    youth: youthCount(state),
  };
}

function log(state: SquadState, input: Parameters<typeof recordEvent>[1]): SquadState {
  return { ...state, eventLog: recordEvent(state.eventLog, input) };
}

/* ==========================================================================
   初始状态
   ========================================================================== */

function createCandidates(rng: RngState): { candidates: SquadCandidate[]; rng: RngState } {
  let current = rng;
  const candidates = CANDIDATE_SEEDS.map((seed) => {
    const draw = nextInt(current, 5);
    current = draw.rng;
    return {
      id: seed.id,
      name: seed.name,
      position: seed.position,
      region: seed.region,
      transferFee: seed.transferFee,
      wage: seed.wage,
      youth: seed.youth,
      ability: seed.baseAbility + draw.value - 2,
    };
  });
  return { candidates, rng: current };
}

/** 把上一关提交的签约转成本关的「已在转会窗签下」名单，避免与本关 21 人与候选重复。 */
function buildInheritedSignings(club: ClubState | undefined): ClubSigning[] {
  if (!club) return [];
  const blockedIds = new Set<string>([
    ...BASE_SQUAD_PLAYERS.map((player) => player.id),
    ...CANDIDATE_SEEDS.map((candidate) => candidate.id),
  ]);
  const blockedNames = new Set<string>([
    ...BASE_SQUAD_PLAYERS.map((player) => player.name),
    ...CANDIDATE_SEEDS.map((candidate) => candidate.name),
  ]);
  const result: ClubSigning[] = [];
  for (const signing of club.signings) {
    if (!signing || typeof signing.name !== 'string' || !signing.name.trim()) continue;
    if (blockedIds.has(signing.id) || blockedNames.has(signing.name)) continue;
    blockedIds.add(signing.id);
    blockedNames.add(signing.name);
    result.push({
      id: signing.id,
      name: signing.name,
      position: signing.position,
      fee: Math.max(0, signing.fee),
      wage: Math.max(0, signing.wage),
      homegrown: signing.homegrown === true,
    });
  }
  return result.slice(0, 6);
}

export function createSquadState(options: CreateSquadOptions): SquadState {
  const rolled = createCandidates(createRng(options.seed));
  const showcase = options.showcaseOptions;
  const club = options.club;
  const inheritedSignings = buildInheritedSignings(club);
  const tacticsPreset = tacticsPresetFromClub(club);
  const startTransferBudget = club ? Math.max(0, Math.round(club.transferBudget * 100)) : TRANSFER_BUDGET;
  const startWageRoom = club ? Math.max(0, club.wageBudget) : WAGE_SPACE;
  let phase: LevelPhase = options.fastStart ? 'faultPlay' : 'commission';
  let modules: SquadModules = {
    tactics: false,
    scouting: false,
    transfers: false,
    registration: false,
    ignoreRegistration: false,
    agent: false,
  };
  let microTaught = false;
  let microChecks = { a: false, b: false };
  let flowStarted = false;
  let step: SquadStep = 'scout';

  if (showcase) {
    if (showcase.startPhase === 'faultPlay') {
      phase = 'faultPlay';
    } else if (showcase.startPhase === 'repair') {
      phase = 'repair';
      modules = {
        tactics: true,
        scouting: true,
        transfers: true,
        registration: true,
        ignoreRegistration: false,
        agent: false,
      };
      microTaught = true;
      microChecks = { a: true, b: true };
    } else if (showcase.startPhase === 'verify') {
      phase = 'verify';
      modules = {
        tactics: true,
        scouting: true,
        transfers: true,
        registration: true,
        ignoreRegistration: false,
        agent: false,
      };
      microTaught = true;
      microChecks = { a: true, b: true };
      flowStarted = true;
      step = 'scout';
    } else {
      phase = 'commission';
    }
  }

  return {
    version: SQUAD_STATE_VERSION,
    phase,
    mode: options.mode,
    fastPlay: showcase?.fastPlay ?? false,
    seed: options.seed,
    rng: rolled.rng,
    eventLog: [],
    evidence: createEvidence(),
    modules,
    inheritedSignings,
    candidates: rolled.candidates,
    microChecks,
    microTaught,
    flowStarted,
    step,
    scouts: emptyScouts(),
    signings: [],
    round: 1,
    tactics: emptyTactics(tacticsPreset),
    tacticsPreset,
    registration: null,
    counterfactualCorrect: false,
    counterfactualAnswered: false,
    reflectionChoice: null,
    reflectionConfirmed: false,
    skippedReflection: false,
    restarts: 0,
    startTransferBudget,
    startWageRoom,
    clubConnected: Boolean(club),
    clubFailures: club ? Math.max(0, club.failures) : 0,
  };
}

/** 测试 / 展示用的现成状态：已通过微教学、四个模块已开、停在名单流程第一步。 */
export function readySquadState(seed: number, fastPlay = false): SquadState {
  const initial = createSquadState({ mode: 'normal', seed, fastStart: false, showcaseOptions: null });
  return {
    ...initial,
    phase: 'verify',
    fastPlay,
    modules: {
      tactics: true,
      scouting: true,
      transfers: true,
      registration: true,
      ignoreRegistration: false,
      agent: false,
    },
    microChecks: { a: true, b: true },
    microTaught: true,
    flowStarted: true,
    evidence: { ...initial.evidence, experiencedFault: true },
  };
}

/* ==========================================================================
   微教学
   ========================================================================== */

export function startMicroTeaching(state: SquadState): SquadActionResult {
  if (state.phase !== 'commission') return { state, ok: false, reason: '现在不在接单阶段。' };
  const next = log(
    { ...state, phase: 'faultPlay' },
    {
      phase: 'faultPlay',
      action: 'micro-start',
      label: '开始注册微教学：比较两份 25 人名单',
      before: { phase: state.phase },
      after: { phase: 'faultPlay' },
      note: '先看「只堆同位置」为什么被注册打回，再看一份能过关的名单。',
    },
  );
  return { state: next, ok: true };
}

export function inspectMicroList(state: SquadState, listId: 'a' | 'b'): SquadActionResult {
  if (state.phase !== 'faultPlay') return { state, ok: false, reason: '现在不在微教学阶段。' };
  const list = MICRO_LISTS.find((item) => item.id === listId);
  if (!list) return { state, ok: false, reason: '未知的名单方案。' };
  if (state.microChecks[listId]) return { state, ok: false, reason: '这份名单已经检查过了。' };
  const items = checkMicroList(list);
  const failed = items.filter((item) => !item.passed);
  const next = log(
    { ...state, microChecks: { ...state.microChecks, [listId]: true } },
    {
      phase: 'faultPlay',
      action: 'micro-check',
      label: `检查名单${listId === 'a' ? 'A' : 'B'}：${list.name}`,
      before: { checkedA: state.microChecks.a ? 1 : 0, checkedB: state.microChecks.b ? 1 : 0 },
      after: { checkedA: listId === 'a' ? 1 : state.microChecks.a ? 1 : 0, checkedB: listId === 'b' ? 1 : state.microChecks.b ? 1 : 0 },
      delta: failed.length === 0 ? '全部通过' : `未通过 ${failed.length} 项`,
      note:
        failed.length === 0
          ? '这份名单同时满足人数、青训与位置覆盖。'
          : `缺口：${failed.map((item) => `${item.label} ${item.actual}/${item.required}`).join('、')}。`,
    },
  );
  return { state: next, ok: true };
}

export function finishMicroTeaching(state: SquadState): SquadActionResult {
  if (state.phase !== 'faultPlay') return { state, ok: false, reason: '现在不在微教学阶段。' };
  if (!state.microChecks.a || !state.microChecks.b) {
    return { state, ok: false, reason: '先分别检查方案 A 与方案 B，再继续维修。' };
  }
  const next = log(
    {
      ...state,
      phase: 'repair',
      microTaught: true,
      evidence: { ...state.evidence, experiencedFault: true },
    },
    {
      phase: 'repair',
      action: 'micro-finish',
      label: '完成注册微教学：只堆同位置会被注册打回',
      before: { phase: 'faultPlay' },
      after: { phase: 'repair' },
      note: '注册规则让「收集强球员」变成「拼一张能过关的名单」。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   维修：模块开关与流程锁定
   ========================================================================== */

export function setSquadModule(state: SquadState, moduleId: SquadModuleId, installed: boolean): SquadActionResult {
  if (state.phase !== 'repair') return { state, ok: false, reason: '只有在维修阶段可以修改模块。' };
  if (state.flowStarted) return { state, ok: false, reason: '正式名单流程已经开始，模块已锁定；修改需要重开本局。' };
  if (!(moduleId in state.modules)) return { state, ok: false, reason: '未知模块。' };
  const next = log(
    { ...state, modules: { ...state.modules, [moduleId]: installed } },
    {
      phase: 'repair',
      action: 'module',
      label: `${installed ? '启用' : '关闭'}模块：${moduleId}`,
      before: { modules: Object.entries(state.modules).filter(([, on]) => on).map(([id]) => id).join('+') || '无' },
      after: { modules: Object.entries({ ...state.modules, [moduleId]: installed }).filter(([, on]) => on).map(([id]) => id).join('+') || '无' },
      note: installed ? '对应规则立即生效。' : MODULE_DEGRADE_NOTES[moduleId],
    },
  );
  return { state: next, ok: true };
}

export function startFlow(state: SquadState): SquadActionResult {
  if (state.phase !== 'repair') return { state, ok: false, reason: '现在不在维修阶段。' };
  if (state.flowStarted) return { state, ok: false, reason: '正式名单流程已经开始。' };
  if (!state.microTaught) return { state, ok: false, reason: '先完成注册微教学。' };
  const next = log(
    {
      ...state,
      phase: 'verify',
      flowStarted: true,
      step: 'scout',
      scouts: emptyScouts(),
      signings: [],
      round: 1,
      tactics: emptyTactics(state.tacticsPreset),
      registration: null,
      counterfactualCorrect: false,
      counterfactualAnswered: false,
      reflectionChoice: null,
      reflectionConfirmed: false,
      skippedReflection: false,
    },
    {
      phase: 'verify',
      action: 'flow-start',
      label: '开始正式名单流程：四个模块已锁定',
      before: { phase: 'repair' },
      after: { phase: 'verify', step: 'scout' },
      note: `需要签下 ${requiredSignings(state)} 人，并让名单通过注册检查。模块修改必须重开本局。`,
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   名单流程 · 球探
   ========================================================================== */

export function assignScout(state: SquadState, regionId: RegionId): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'scout') return { state, ok: false, reason: '现在不在球探阶段。' };
  if (state.scouts.confirmed) return { state, ok: false, reason: '考察已经完成，不能再调整球探。' };
  if (!state.modules.scouting) return { state, ok: false, reason: '球探网络未启用，不能派遣球探。' };
  if (!(regionId in state.scouts.assignments)) return { state, ok: false, reason: '未知区域。' };
  if (scoutAssignmentsTotal(state) >= SCOUT_COUNT) {
    return { state, ok: false, reason: `只有 ${SCOUT_COUNT} 名球探，已经全部派出。` };
  }
  const region = REGIONS.find((item) => item.id === regionId);
  const next = log(
    {
      ...state,
      scouts: {
        ...state.scouts,
        assignments: {
          ...state.scouts.assignments,
          [regionId]: state.scouts.assignments[regionId] + 1,
        },
      },
    },
    {
      phase: 'verify',
      action: 'scout-assign',
      label: `派遣 1 名球探：${region?.name ?? regionId}`,
      before: { scouts: scoutAssignmentsTotal(state) },
      after: { scouts: scoutAssignmentsTotal(state) + 1 },
      note: `${region?.name ?? '该区域'}的知识度会随着球探人数提高；同一区域派 2 人时知识度更高。`,
    },
  );
  return { state: next, ok: true };
}

export function unassignScout(state: SquadState, regionId: RegionId): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'scout') return { state, ok: false, reason: '现在不在球探阶段。' };
  if (state.scouts.confirmed) return { state, ok: false, reason: '考察已经完成，不能再调整球探。' };
  if (!(regionId in state.scouts.assignments)) return { state, ok: false, reason: '未知区域。' };
  if (state.scouts.assignments[regionId] <= 0) return { state, ok: false, reason: '这个区域还没有派遣球探。' };
  const region = REGIONS.find((item) => item.id === regionId);
  const next = log(
    {
      ...state,
      scouts: {
        ...state.scouts,
        assignments: {
          ...state.scouts.assignments,
          [regionId]: state.scouts.assignments[regionId] - 1,
        },
      },
    },
    {
      phase: 'verify',
      action: 'scout-unassign',
      label: `撤回 1 名球探：${region?.name ?? regionId}`,
      before: { scouts: scoutAssignmentsTotal(state) },
      after: { scouts: scoutAssignmentsTotal(state) - 1 },
      note: '可以重新分配这 1 名球探。',
    },
  );
  return { state: next, ok: true };
}

export function confirmScout(state: SquadState): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'scout') return { state, ok: false, reason: '现在不在球探阶段。' };
  if (state.scouts.confirmed) return { state, ok: false, reason: '考察已经完成。' };
  if (state.modules.scouting && scoutAssignmentsTotal(state) !== SCOUT_COUNT) {
    return { state, ok: false, reason: `需要把 ${SCOUT_COUNT} 名球探全部派出，再完成考察。` };
  }
  const next = log(
    { ...state, scouts: { ...state.scouts, confirmed: true }, step: 'transfer', round: 1 },
    {
      phase: 'verify',
      action: 'scout-confirm',
      label: state.modules.scouting
        ? `完成 1 轮考察：${knowledgeText(state)}`
        : '跳过考察（球探网络未启用，信息完全公开）',
      before: { step: 'scout' },
      after: { step: 'transfer' },
      note: state.modules.scouting
        ? '知识度不足的候选只能看到能力区间，不能直接看到精确值。'
        : '球探网络未启用，所有候选能力完全公开。目标二不会达成。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   名单流程 · 转会
   ========================================================================== */

export interface SignCheck {
  ok: boolean;
  reason?: string;
}

export function canSignCandidate(state: SquadState, candidateId: string): SignCheck {
  if (state.phase !== 'verify' || state.step !== 'transfer') return { ok: false, reason: '现在不在转会阶段。' };
  const candidate = candidateById(state, candidateId);
  if (!candidate) return { ok: false, reason: '找不到这名候选。' };
  if (state.signings.includes(candidateId)) return { ok: false, reason: `${candidate.name} 已经签下。` };
  if (state.signings.length >= requiredSignings(state)) {
    return { ok: false, reason: `本次名单只需要签下 ${requiredSignings(state)} 人，已经签满。` };
  }
  // 「全权交给经纪人」会让签约不再被预算 / 工资拦住（无竞争、无谈判）。
  if (state.modules.transfers && !state.modules.agent) {
    if (candidate.transferFee > remainingBudget(state)) {
      return {
        ok: false,
        reason: `转会预算不足：${candidate.name} 需要 ${formatSquadFee(candidate.transferFee)}，剩余 ${formatSquadFee(remainingBudget(state))}。`,
      };
    }
    if (candidate.wage > remainingWage(state)) {
      return {
        ok: false,
        reason: `工资空间不足：${candidate.name} 需要 ${formatSquadWage(candidate.wage)}，剩余 ${formatSquadWage(remainingWage(state))}。`,
      };
    }
  }
  return { ok: true };
}

export function signCandidate(state: SquadState, candidateId: string): SquadActionResult {
  const check = canSignCandidate(state, candidateId);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const candidate = candidateById(state, candidateId);
  if (!candidate) return { state, ok: false, reason: '找不到这名候选。' };
  const knowledge = regionKnowledge(state, candidate.region);
  const nextSignings = [...state.signings, candidateId];
  const next = log(
    {
      ...state,
      signings: nextSignings,
      round: state.round + 1,
    },
    {
      phase: 'verify',
      action: 'sign',
      label: `第 ${state.signings.length + 1} 签：${candidate.name}（${POSITION_LABELS[candidate.position]}${candidate.youth ? ' · 本土青训' : ''}）`,
      before: flowSnapshot(state),
      after: {
        ...flowSnapshot({ ...state, signings: nextSignings }),
        knowledge,
      },
      delta: state.modules.agent
        ? `-${formatSquadFee(candidate.transferFee)} / -${formatSquadWage(candidate.wage)}（经纪人：未做预算/工资检查）`
        : state.modules.transfers
          ? `-${formatSquadFee(candidate.transferFee)} / -${formatSquadWage(candidate.wage)}`
          : '预算与工资未启用，本次签约不扣资源（退化规则）',
      note:
        state.modules.agent
          ? '全权交给经纪人：这次签约没有经过预算与工资检查，注册阶段仍会按缩减后的上限重新检查。'
          : knowledge > 0 && knowledge < 100
            ? `本次选择依据知识度 ${knowledge} 的考察报告。`
            : knowledge >= 100
              ? '球探网络未启用，所有能力信息完全公开。'
              : '这名候选所在区域没有考察报告，属于盲目签约。',
    },
  );
  return { state: next, ok: true };
}

export function finishSigning(state: SquadState): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'transfer') return { state, ok: false, reason: '现在不在转会阶段。' };
  if (state.signings.length === 0 && requiredSignings(state) > 0) {
    return { state, ok: false, reason: '至少先签下 1 人，再进入战术阶段。' };
  }
  const next = log(
    { ...state, step: 'tactics' },
    {
      phase: 'verify',
      action: 'sign-finish',
      label: `结束签约：签下 ${state.signings.length} / ${requiredSignings(state)} 人`,
      before: flowSnapshot(state),
      after: { ...flowSnapshot(state), step: 'tactics' },
      note:
        state.signings.length >= requiredSignings(state)
          ? '签约人数达到目标，进入战术阶段。'
          : `签约人数不足 ${requiredSignings(state)} 人，注册检查很可能会失败；之后可以回到维修台重新配置。`,
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   名单流程 · 战术
   ========================================================================== */

function setTacticField(
  state: SquadState,
  field: 'possessionId' | 'outId' | 'decisionId',
  id: string,
  label: string,
): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'tactics') return { state, ok: false, reason: '现在不在战术阶段。' };
  if (!state.modules.tactics) return { state, ok: false, reason: '双形态战术未启用，不能设置两套形态。' };
  const presets = field === 'possessionId' ? POSSESSION_PRESETS : field === 'outId' ? OUT_PRESETS : MATCH_DECISIONS;
  const preset = presets.find((item) => item.id === id);
  if (!preset) return { state, ok: false, reason: '未知的战术选项。' };
  const next = log(
    { ...state, tactics: { ...state.tactics, [field]: id } },
    {
      phase: 'verify',
      action: 'tactics-set',
      label: `${label}：${preset.name}`,
      before: { [field]: (state.tactics[field] as string | null) ?? '未设置' },
      after: { [field]: id },
      note: preset.description,
    },
  );
  return { state: next, ok: true };
}

export function setPossessionShape(state: SquadState, id: string): SquadActionResult {
  return setTacticField(state, 'possessionId', id, '设置有球形态');
}

export function setOutOfPossessionShape(state: SquadState, id: string): SquadActionResult {
  return setTacticField(state, 'outId', id, '设置无球形态');
}

export function setMatchDecision(state: SquadState, id: string): SquadActionResult {
  return setTacticField(state, 'decisionId', id, '设置比赛阶段决策');
}

export function confirmTactics(state: SquadState): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'tactics') return { state, ok: false, reason: '现在不在战术阶段。' };
  if (!state.modules.tactics) return { state, ok: false, reason: '双形态战术未启用，不能提交战术决策。' };
  if (!state.tactics.possessionId || !state.tactics.outId || !state.tactics.decisionId) {
    return { state, ok: false, reason: '需要先选好有球形态、无球形态与比赛阶段决策。' };
  }
  const withTactics: SquadState = { ...state, tactics: { ...state.tactics, confirmed: true } };
  const report = buildMatchReport(withTactics);
  const next = log(
    { ...withTactics, step: 'registration', tactics: { ...withTactics.tactics, matchReport: report } },
    {
      phase: 'verify',
      action: 'tactics-confirm',
      label: '提交比赛阶段决策',
      before: { step: 'tactics' },
      after: { step: 'registration' },
      note: report,
    },
  );
  return { state: next, ok: true };
}

export function skipTactics(state: SquadState): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'tactics') return { state, ok: false, reason: '现在不在战术阶段。' };
  if (state.modules.tactics) return { state, ok: false, reason: '双形态战术已启用，需要完成两套形态与比赛决策。' };
  const next = log(
    { ...state, step: 'registration' },
    {
      phase: 'verify',
      action: 'tactics-skip',
      label: '跳过战术阶段：双形态战术未启用',
      before: { step: 'tactics' },
      after: { step: 'registration' },
      note: '只有一套站位打满全场，目标一不会达成。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   名单流程 · 注册
   ========================================================================== */

export function checkRegistration(state: SquadState): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'registration') {
    return { state, ok: false, reason: '现在不在注册检查阶段。' };
  }
  if (state.registration) return { state, ok: false, reason: '本局已经运行过注册检查，重复检查不会改变名单。' };
  const registration = evaluateRegistration(state);
  const operated = operatedMechanicMet({ ...state, registration });
  const label = registration.skippedByIgnore
    ? '运行注册检查：已启用「无视注册规则」，跳过检查直接放行'
    : registration.enabled
      ? `运行注册检查：${registration.passed ? '通过' : '未通过'}`
      : '运行注册检查：注册规则未启用（退化通过）';
  const next = log(
    {
      ...state,
      registration,
      evidence: operated ? { ...state.evidence, operatedMechanic: true } : state.evidence,
    },
    {
      phase: 'verify',
      action: 'registration-check',
      label,
      before: { total: squadTotal(state), youth: youthCount(state) },
      after: { total: registration.total, youth: registration.youth, passed: registration.passed ? 1 : 0 },
      delta: registration.skippedByIgnore
        ? '目标三无法达成'
        : registration.passed
          ? '名单可注册'
          : '存在缺口',
      note: registration.note,
    },
  );
  return { state: next, ok: true };
}

export function advanceToReflection(state: SquadState): SquadActionResult {
  if (state.phase !== 'verify' || state.step !== 'registration') {
    return { state, ok: false, reason: '先完成注册检查。' };
  }
  if (!state.registration) return { state, ok: false, reason: '还没有运行注册检查。' };
  if (!state.registration.passed) {
    return { state, ok: false, reason: '名单没有通过注册检查。调整目标需要重开本局，补齐青训 / 位置 / 工资缺口。' };
  }
  const next = log(
    { ...state, phase: 'transfer' },
    {
      phase: 'transfer',
      action: 'to-reflection',
      label: '进入结算与反思',
      before: { step: 'registration' },
      after: { phase: 'transfer' },
      note: '结算只展示真实名单、预算与证据，不评高分。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   结算与反思
   ========================================================================== */

export interface CounterfactualQuestion {
  question: string;
  options: QuizOption[];
  correctId: string;
  explanations: Record<string, string>;
}

/**
 * 按真实缺口动态生成反事实题：
 * - 名单有真实缺口（青训 / 工资 / 位置 / 人数）时，直接问这个缺口怎么补；
 * - 名单按真实规则通过时，用「青训差 1」「再签 1 名非青训」等假设继续检验理解；
 * - 启用「无视注册规则」时，strictRegistration 会给出被跳过的真实缺口，题目据此生成。
 */
export function buildCounterfactual(state: SquadState): CounterfactualQuestion {
  const strict = strictRegistration(state);
  const gaps = strict.items.filter((item) => !item.passed && !item.skipped);
  const firstGap = gaps[0];

  if (firstGap) {
    if (firstGap.id === 'youth') {
      if (strict.total >= SQUAD_LIMIT) {
        return {
          question: `按真实规则检查：名单 ${strict.total}/${SQUAD_LIMIT} 人已经满员，本土青训只有 ${strict.youth}/${YOUTH_MIN} 人。如果直接再签 1 名本土青训，注册能通过吗？需要先处理哪个名额？`,
          options: COUNTERFACTUAL_OPTIONS,
          correctId: COUNTERFACTUAL_CORRECT_ID,
          explanations: COUNTERFACTUAL_EXPLANATIONS,
        };
      }
      return {
        question: `按真实规则检查：名单 ${strict.total}/${SQUAD_LIMIT} 人还有空位，但本土青训只有 ${strict.youth}/${YOUTH_MIN} 人。直接再签 1 名本土青训，注册能通过吗？`,
        options: [
          { id: 'sign-youth', label: '能：人数还有空位，补 1 名本土青训后青训与人数同时满足。' },
          { id: 'must-remove', label: '不能：必须先从现有名单移出 1 名非青训球员，才能签青训。' },
          { id: 'ignore-youth', label: '能：青训名额只在转会时检查，注册时不再检查。' },
          { id: 'wage-only', label: '不能：青训补不补无所谓，工资空间一定会超。' },
        ],
        correctId: 'sign-youth',
        explanations: {
          'sign-youth': '正确：人数上限还有空位，补 1 名本土青训就同时满足人数与青训两个约束。',
          'must-remove': '人数还没满，不需要先腾名额；直接签青训就能补齐。',
          'ignore-youth': '青训名额正是注册检查的一项，不能用转会阶段的说法绕过去。',
          'wage-only': '工资是另一个约束；这道题的关键是青训与人数都还有操作空间。',
        },
      };
    }

    if (firstGap.id === 'wage') {
      const over = Math.max(0, strict.wage - strict.wageCap);
      return {
        question: `按真实规则检查：周薪 ${strict.wage}k/周 超过上限 ${strict.wageCap}k/周，超出 ${over}k。要让名单通过注册，至少需要腾出多少周薪空间？`,
        options: [
          { id: 'clear-over', label: `至少腾出 ${over}k/周，把周薪总额降到 ${strict.wageCap}k/周 以内。` },
          { id: 'no-check', label: '不用腾：注册检查只看人数，不看工资。' },
          { id: 'double', label: `要腾出 ${over * 2}k/周，超出 1 倍才需要停。` },
          { id: 'budget', label: '只要转会预算够，工资超一点也能注册。' },
        ],
        correctId: 'clear-over',
        explanations: {
          'clear-over': `正确：周薪上限是硬约束，当前超了 ${over}k/周，至少要腾出这么多空间。`,
          'no-check': '工资空间是注册检查的一项，不是只显示的数字。',
          double: `不需要超额腾出，超过上限的部分正好是 ${over}k/周。`,
          budget: '转会预算与工资是两个独立上限，预算充足不能抵消工资超限。',
        },
      };
    }

    if (firstGap.id === 'size') {
      const over = strict.total - SQUAD_LIMIT;
      return {
        question: `按真实规则检查：名单 ${strict.total}/${SQUAD_LIMIT} 人，超出上限 ${over} 人。最直接的修复是什么？`,
        options: [
          { id: 'remove', label: `移出 ${over} 名球员，把人数降到 ${SQUAD_LIMIT} 人以内。` },
          { id: 'ignore', label: '不用处理：人数上限只是建议。' },
          { id: 'add', label: '再签 1 名青训球员，青训名额会抵消多出来的人数。' },
          { id: 'wage', label: '只要工资不超，人数超出也没关系。' },
        ],
        correctId: 'remove',
        explanations: {
          remove: `正确：25 人是硬上限，超出 ${over} 人就必须先移出球员。`,
          ignore: '25 人上限是注册规则的一部分，不是建议。',
          add: '再签人只会让超出更多；青训名额不会抵消人数上限。',
          wage: '工资与人数是两个独立检查项，工资合规不能抵消人数超出。',
        },
      };
    }

    const position = POSITIONS.find((item) => item.toLowerCase() === firstGap.id);
    const label = position ? POSITION_LABELS[position] : firstGap.label;
    const gapCount = firstGap.required - firstGap.actual;
    return {
      question: `按真实规则检查：${firstGap.label}只有 ${firstGap.actual}/${firstGap.required} 人，还差 ${gapCount} 人。最直接的补法是什么？`,
      options: [
        { id: 'add-position', label: `再签 ${gapCount} 名${label}球员，补足 ${firstGap.required} 人的最低覆盖。` },
        { id: 'add-any', label: '随便再签 1 名球员就行，注册不检查位置。' },
        { id: 'youth-only', label: '只补本土青训名额，位置覆盖会自动满足。' },
        { id: 'remove', label: '移出 1 名其他位置球员来腾出位置。' },
      ],
      correctId: 'add-position',
      explanations: {
        'add-position': `正确：位置覆盖按位置单独计数，${label}还差 ${gapCount} 人。`,
        'add-any': '位置覆盖是独立检查项，签其他位置补不上这个缺口。',
        'youth-only': '青训名额与位置覆盖是两套检查，补青训不等于补位置。',
        remove: '移出球员只会让某个位置人数更少，不能补上缺口。',
      },
    };
  }

  if (strict.total >= SQUAD_LIMIT) {
    return {
      question: `这份名单按真实规则检查可以通过：${strict.total}/${SQUAD_LIMIT} 人、青训 ${strict.youth}/${YOUTH_MIN}。反事实：如果青训只有 ${Math.max(0, strict.youth - 1)} 人（差 1），而人数仍然满 ${SQUAD_LIMIT}，再签 1 名本土青训能直接通过吗？`,
      options: COUNTERFACTUAL_OPTIONS,
      correctId: COUNTERFACTUAL_CORRECT_ID,
      explanations: COUNTERFACTUAL_EXPLANATIONS,
    };
  }

  return {
    question: `这份名单按真实规则检查可以通过：${strict.total}/${SQUAD_LIMIT} 人、青训 ${strict.youth}/${YOUTH_MIN}。反事实：如果现在再签 1 名非青训球员（人数变成 ${strict.total + 1} 人，仍未满 ${SQUAD_LIMIT}），青训名额仍是 ${strict.youth}/${YOUTH_MIN}，注册还能通过吗？`,
    options: [
      { id: 'still-pass', label: '能：人数没超、青训没减少，其他位置覆盖也不变。' },
      { id: 'youth-fail', label: '不能：签非青训球员会让青训名额立刻不足。' },
      { id: 'remove', label: '不能：必须先从现有名单移出 1 名球员。' },
      { id: 'wage', label: '不能：再签任何人都会让工资一定超限。' },
    ],
    correctId: 'still-pass',
    explanations: {
      'still-pass': '正确：人数上限还有空位，青训人数不变，其他检查项也没有被破坏。',
      'youth-fail': '青训人数是绝对数量，签非青训不会减少已有青训人数。',
      remove: '人数还没满，不需要先腾名额。',
      wage: '工资是否超限取决于具体球员，不是「再签任何人」都会超。',
    },
  };
}

export function answerCounterfactual(state: SquadState, optionId: string): SquadActionResult {
  if (state.phase !== 'transfer') return { state, ok: false, reason: '现在不在结算阶段。' };
  const question = buildCounterfactual(state);
  if (optionId !== question.correctId) {
    return { state, ok: false, correct: false, reason: '这个计算还没有对上，看看解释再试一次。' };
  }
  const next = log(
    { ...state, counterfactualCorrect: true, counterfactualAnswered: true },
    {
      phase: 'transfer',
      action: 'counterfactual-correct',
      label: `反事实计算正确：${question.options.find((option) => option.id === optionId)?.label.slice(0, 24) ?? ''}…`,
      before: { counterfactual: 0 },
      after: { counterfactual: 1 },
      note: question.explanations[optionId] ?? '动态反事实题按真实缺口生成。',
    },
  );
  return { state: next, ok: true, correct: true };
}

export function confirmReflection(state: SquadState, optionId: string): SquadActionResult {
  if (state.phase !== 'transfer') return { state, ok: false, reason: '现在不在结算阶段。' };
  const option = REFLECTION_OPTIONS.find((item) => item.id === optionId);
  if (!option) return { state, ok: false, reason: '未知的解释选项。' };
  const next = log(
    {
      ...state,
      phase: 'summary',
      reflectionChoice: optionId,
      reflectionConfirmed: true,
      evidence: { ...state.evidence, transferred: true },
    },
    {
      phase: 'summary',
      action: 'reflection-confirm',
      label: `确认反思解释：${option.label.slice(0, 18)}…`,
      before: { phase: 'transfer' },
      after: { phase: 'summary' },
      note: option.feedback,
    },
  );
  return { state: next, ok: true };
}

export function skipReflection(state: SquadState): SquadActionResult {
  if (state.phase !== 'transfer') return { state, ok: false, reason: '现在不在结算阶段。' };
  if (state.mode !== 'showcase') return { state, ok: false, reason: '正常模式不能跳过结算反思。' };
  const next = log(
    { ...state, phase: 'summary', skippedReflection: true },
    {
      phase: 'summary',
      action: 'reflection-skip',
      label: '演示跳过反事实与反思题（不计 transferred）',
      before: { phase: 'transfer' },
      after: { phase: 'summary' },
      note: '演示模式只展示名单与三项目标证据。',
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   重开本局：清空名单流程成绩，保留模块与微教学
   ========================================================================== */

export function restartRun(state: SquadState): SquadActionResult {
  if (state.phase !== 'verify' && state.phase !== 'transfer' && state.phase !== 'summary') {
    return { state, ok: false, reason: '现在还不能回到维修台重新配置。' };
  }
  const keptLog = state.eventLog.filter((entry) => entry.phase !== 'verify');
  const next = log(
    {
      ...state,
      phase: 'repair',
      flowStarted: false,
      step: 'scout' as SquadStep,
      scouts: emptyScouts(),
      signings: [],
      round: 1,
      tactics: emptyTactics(state.tacticsPreset),
      registration: null,
      counterfactualCorrect: false,
      counterfactualAnswered: false,
      reflectionChoice: null,
      reflectionConfirmed: false,
      skippedReflection: false,
      restarts: state.restarts + 1,
      eventLog: keptLog,
      evidence: { ...state.evidence, operatedMechanic: false, transferred: false },
    },
    {
      phase: 'repair',
      action: 'restart',
      label: `回到维修台重新配置：清空名单流程成绩（第 ${state.restarts + 1} 次）`,
      before: { signings: state.signings.length, step: state.step, budget: budgetCap(state) },
      after: { signings: 0, step: 'scout', phase: 'repair', budget: Math.max(0, budgetBase(state) - REWORK_COST) },
      delta: `俱乐部承担 ${formatSquadFee(REWORK_COST)} 紧急处理成本`,
      note: `每次注册/目标未达成后的重新配置都记一次返工：俱乐部承担 ${formatSquadFee(
        REWORK_COST,
      )} 紧急处理成本，从转会预算扣除（最低 0）。模块配置与注册微教学保留。`,
    },
  );
  return { state: next, ok: true };
}

/* ==========================================================================
   归档总结
   ========================================================================== */

function newSigningsAsClubSignings(state: SquadState): ClubSigning[] {
  return signedCandidates(state).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    position: POSITION_LABELS[candidate.position],
    fee: Math.max(0, Math.round((candidate.transferFee / 100) * 10) / 10),
    wage: candidate.wage,
    homegrown: candidate.youth,
  }));
}

function newWageSum(state: SquadState): number {
  return signedCandidates(state).reduce((total, candidate) => total + candidate.wage, 0);
}

/** 真实注册结果 / 名单 / 青训 / 工资，写成赛季报告。 */
export function buildSquadSeasonReport(state: SquadState): ClubSeasonReport {
  const registration = state.registration ?? evaluateRegistration(state);
  const coverage = rosterGroups(state)
    .map((group) => `${group.label} ${group.count}/${group.min}`)
    .join('、');
  const registrationText = registration.skippedByIgnore
    ? '被「无视注册规则」跳过'
    : registration.enabled
      ? registration.passed
        ? '通过'
        : '未通过'
      : '注册规则未启用（退化放行）';
  const inherited = state.inheritedSignings.map((signing) => `${signing.name}（${signing.position}）`);
  const newSignings = signedCandidates(state).map(
    (candidate) => `${candidate.name}（${POSITION_LABELS[candidate.position]}${candidate.youth ? ' · 青训' : ''}）`,
  );
  return {
    headline: `注册完成：名单 ${registration.total}/${SQUAD_LIMIT} 人，青训 ${registration.youth}/${YOUTH_MIN}，周薪 €${registration.wage}k/€${registration.wageCap}k`,
    details: [
      `注册检查：${registrationText}；人数 ${registration.total}/${SQUAD_LIMIT}、青训 ${registration.youth}/${YOUTH_MIN}、周薪 €${registration.wage}k / €${registration.wageCap}k。`,
      `位置覆盖：${coverage}。`,
      `引援：转会窗已签 ${inherited.length > 0 ? inherited.join('、') : '无'}；注册日新签 ${
        newSignings.length > 0 ? newSignings.join('、') : '无'
      }。`,
      `预算：返工 ${reworkCount(state)} 次、俱乐部承担 ${formatSquadFee(reworkCostPaid(state))} 成本；本关预算剩余 ${formatSquadFee(
        Math.max(0, budgetBase(state) - feeUsed(state)),
      )} / 起始 ${formatSquadFee(state.startTransferBudget)}。`,
    ],
  };
}

export function squadSummaryLines(state: SquadState): string[] {
  const goals = evaluateGoals(state);
  const registration = state.registration ?? evaluateRegistration(state);
  const moduleLine = [
    `双形态战术（${state.modules.tactics ? '已启用' : '未启用'}）`,
    `球探网络（${state.modules.scouting ? '已启用' : '未启用'}）`,
    `转会谈判（${state.modules.transfers ? '已启用' : '未启用'}）`,
    `阵容注册（${state.modules.registration ? '已启用' : '未启用'}）`,
    state.modules.ignoreRegistration ? '无视注册规则（已启用，目标三被跳过）' : '',
    state.modules.agent ? '全权交给经纪人（已启用，预算/工资各扣 10%）' : '',
  ]
    .filter(Boolean)
    .join('、');
  const registrationText = registration.skippedByIgnore
    ? '被「无视注册规则」跳过'
    : registration.enabled
      ? registration.passed
        ? '通过'
        : '未通过'
      : '在退化规则下直接通过';
  return [
    `规则组合：${moduleLine}，同时作用于同一份名单。`,
    `真实操作：从转会窗带入 ${state.inheritedSignings.length} 人，本关签约 ${state.signings.length} 人，名单 ${
      registration.total
    }/${SQUAD_LIMIT} 人、青训 ${registration.youth}/${YOUTH_MIN}、周薪 €${registration.wage}k/${registration.wageCap}k；注册检查${registrationText}。三项目标达成 ${
      goals.filter((goal) => goal.achieved).length
    } / 3。`,
    `代价与组合：注册规则把「收集强球员」变成「拼一张能过关的名单」；返工 ${reworkCount(state)} 次让俱乐部承担 ${formatSquadFee(
      reworkCostPaid(state),
    )} 紧急处理成本，跨关预算和薪资空间会一起变紧。`,
  ];
}

/** 俱乐部时间线：只写真实名单、注册检查、位置覆盖、跨关引援、返工与预算数据。 */
export function buildSquadClubUpdate(state: SquadState): ClubUpdate {
  const registration = state.registration ?? evaluateRegistration(state);
  const signed = signedCandidates(state);
  const signedYouth = signed.filter((candidate) => candidate.youth).length;
  const coverage = rosterGroups(state)
    .map((group) => `${group.label} ${group.count}/${group.min}`)
    .join('、');
  const registrationText = registration.skippedByIgnore
    ? '被「无视注册规则」跳过'
    : registration.enabled
      ? registration.passed
        ? '通过'
        : '未通过'
      : '注册规则未启用（退化放行）';
  const inheritedNames = state.inheritedSignings.map((signing) => `${signing.name}（${signing.position}）`);
  const extraModules = [
    state.modules.ignoreRegistration ? '无视注册规则' : '',
    state.modules.agent ? '全权交给经纪人' : '',
  ].filter(Boolean);
  return {
    headline: `注册日：名单 ${registration.total}/${SQUAD_LIMIT} 人，青训 ${registration.youth}/${YOUTH_MIN}，周薪 €${registration.wage}k/€${registration.wageCap}k`,
    details: [
      `注册检查：${registrationText}；人数 ${registration.total}/${SQUAD_LIMIT}、青训 ${registration.youth}/${YOUTH_MIN}、周薪 €${registration.wage}k / €${registration.wageCap}k。`,
      `位置覆盖：${coverage}。`,
      `跨关引援：转会窗已签 ${inheritedNames.length > 0 ? inheritedNames.join('、') : '无'}；本关新签 ${
        signed.length > 0 ? `${signed.map((candidate) => candidate.name).join('、')}（青训 ${signedYouth} 人）` : '无'
      }。预算：返工 ${reworkCount(state)} 次、成本 ${formatSquadFee(reworkCostPaid(state))}，剩余 ${formatSquadFee(
        Math.max(0, budgetBase(state) - feeUsed(state)),
      )} / 起始 ${formatSquadFee(state.startTransferBudget)}。`,
      `模块：双形态战术${state.modules.tactics ? '已启用' : '未启用'}、球探网络${state.modules.scouting ? '已启用' : '未启用'}、转会谈判${
        state.modules.transfers ? '已启用' : '未启用'
      }、阵容注册${state.modules.registration ? '已启用' : '未启用'}${
        extraModules.length > 0 ? `；另装了${extraModules.join('、')}` : ''
      }。`,
    ],
    nextBrief: '下一份委托：带着这份真实名单进入新赛季，观察战术、球探与注册规则在比赛里的连锁反应。',
  };
}

/** 跨关俱乐部增量：最终名单签约（含转会窗引援）、绝对剩余预算、返工次数与赛季报告。 */
export function buildSquadClubPatch(state: SquadState): ClubPatch {
  return {
    signings: [...state.inheritedSignings, ...newSigningsAsClubSignings(state)],
    transferBudget: Math.max(0, Math.round(((budgetBase(state) - feeUsed(state)) / 100) * 10) / 10),
    wageBudget: Math.max(0, Math.round((state.startWageRoom - newWageSum(state)) * 10) / 10),
    addFailures: reworkCount(state),
    seasonReport: buildSquadSeasonReport(state),
  };
}

/* ==========================================================================
   存档恢复
   ========================================================================== */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const PHASE_LIST: LevelPhase[] = ['commission', 'faultPlay', 'diagnose', 'repair', 'verify', 'transfer', 'summary'];
const STEP_LIST: SquadStep[] = ['scout', 'transfer', 'tactics', 'registration'];
const MODULE_IDS: SquadModuleId[] = SQUAD_MODULE_IDS;

function isPhase(value: unknown): value is LevelPhase {
  return typeof value === 'string' && (PHASE_LIST as string[]).includes(value);
}

function isStep(value: unknown): value is SquadStep {
  return typeof value === 'string' && (STEP_LIST as string[]).includes(value);
}

function reviveCandidates(raw: unknown): SquadCandidate[] | null {
  if (!Array.isArray(raw) || raw.length !== CANDIDATE_SEEDS.length) return null;
  const candidates: SquadCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const data = item as Record<string, unknown>;
    const seed = CANDIDATE_SEEDS.find((candidate) => candidate.id === data.id);
    if (!seed) return null;
    if (typeof data.name !== 'string' || typeof data.position !== 'string' || typeof data.region !== 'string') return null;
    if (!isFiniteNumber(data.transferFee) || !isFiniteNumber(data.wage) || typeof data.youth !== 'boolean') return null;
    if (!isFiniteNumber(data.ability)) return null;
    candidates.push({
      id: seed.id,
      name: data.name,
      position: data.position as SquadPosition,
      region: data.region as RegionId,
      transferFee: data.transferFee,
      wage: data.wage,
      youth: data.youth,
      ability: data.ability,
    });
  }
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) return null;
  return candidates;
}

function reviveRegistration(raw: unknown): RegistrationResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.enabled !== 'boolean' || typeof data.passed !== 'boolean') return null;
  if (typeof data.skippedByIgnore !== 'boolean') return null;
  if (!Array.isArray(data.items)) return null;
  if (!isFiniteNumber(data.total) || !isFiniteNumber(data.youth) || !isFiniteNumber(data.wage)) return null;
  if (!isFiniteNumber(data.wageCap) || !isFiniteNumber(data.budgetCap)) return null;
  if (!isFiniteNumber(data.budgetUsed) || typeof data.note !== 'string') return null;
  if (!data.counts || typeof data.counts !== 'object') return null;
  const counts = data.counts as Record<string, unknown>;
  for (const position of POSITIONS) {
    if (!isFiniteNumber(counts[position])) return null;
  }
  const items: RegistrationItem[] = [];
  for (const item of data.items) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || typeof entry.label !== 'string') return null;
    if (!isFiniteNumber(entry.actual) || !isFiniteNumber(entry.required) || typeof entry.passed !== 'boolean') return null;
    items.push({
      id: entry.id,
      label: entry.label,
      actual: entry.actual,
      required: entry.required,
      passed: entry.passed,
      skipped: typeof entry.skipped === 'boolean' ? entry.skipped : undefined,
      detail: typeof entry.detail === 'string' ? entry.detail : undefined,
    });
  }
  return {
    enabled: data.enabled,
    passed: data.passed,
    skippedByIgnore: data.skippedByIgnore,
    items,
    total: data.total,
    youth: data.youth,
    counts: { GK: counts.GK as number, DF: counts.DF as number, MF: counts.MF as number, FW: counts.FW as number },
    wage: data.wage,
    wageCap: data.wageCap,
    budgetCap: data.budgetCap,
    budgetUsed: data.budgetUsed,
    note: data.note,
  };
}

function reviveTactics(raw: unknown): TacticsState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const optionalString = (value: unknown): boolean => value === null || typeof value === 'string';
  if (!optionalString(data.possessionId) || !optionalString(data.outId) || !optionalString(data.decisionId)) return null;
  if (typeof data.confirmed !== 'boolean') return null;
  if (!optionalString(data.matchReport)) return null;
  return {
    possessionId: data.possessionId as string | null,
    outId: data.outId as string | null,
    decisionId: data.decisionId as string | null,
    confirmed: data.confirmed,
    matchReport: data.matchReport as string | null,
  };
}

function reviveScouts(raw: unknown): ScoutsState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!data.assignments || typeof data.assignments !== 'object') return null;
  const assignments = data.assignments as Record<string, unknown>;
  for (const region of REGIONS) {
    if (!isFiniteNumber(assignments[region.id])) return null;
  }
  if (typeof data.confirmed !== 'boolean') return null;
  return {
    assignments: {
      east: assignments.east as number,
      plateau: assignments.plateau as number,
      port: assignments.port as number,
    },
    confirmed: data.confirmed,
  };
}

function reviveInheritedSignings(raw: unknown): ClubSigning[] | null {
  if (!Array.isArray(raw)) return null;
  const result: ClubSigning[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const data = item as Record<string, unknown>;
    if (typeof data.id !== 'string' || typeof data.name !== 'string' || typeof data.position !== 'string') return null;
    if (!isFiniteNumber(data.fee) || !isFiniteNumber(data.wage) || typeof data.homegrown !== 'boolean') return null;
    result.push({
      id: data.id,
      name: data.name,
      position: data.position,
      fee: Math.max(0, data.fee),
      wage: Math.max(0, data.wage),
      homegrown: data.homegrown,
    });
  }
  return result;
}

function reviveTacticsPreset(raw: unknown): { possessionId: string | null; outId: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const optionalString = (value: unknown): boolean => value === null || typeof value === 'string';
  if (!optionalString(data.possessionId) || !optionalString(data.outId)) return null;
  return {
    possessionId: data.possessionId as string | null,
    outId: data.outId as string | null,
  };
}

/** 只接受结构完整的存档；损坏存档返回 null，由组件从头开始。 */
export function reviveSquadState(raw: unknown): SquadState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (data.version !== SQUAD_STATE_VERSION) return null;
  if (!isPhase(data.phase)) return null;
  if (data.mode !== 'normal' && data.mode !== 'showcase') return null;
  if (!isStep(data.step)) return null;
  if (!isRngState(data.rng)) return null;
  const rng = reviveRng(data.rng);
  const candidates = reviveCandidates(data.candidates);
  if (!candidates) return null;
  const inheritedSignings = reviveInheritedSignings(data.inheritedSignings);
  if (!inheritedSignings) return null;
  const tacticsPreset = reviveTacticsPreset(data.tacticsPreset);
  if (!tacticsPreset) return null;
  if (!Array.isArray(data.eventLog)) return null;
  const eventLog: EventLogEntry[] = [];
  for (const item of data.eventLog) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (!isFiniteNumber(entry.seq) || typeof entry.action !== 'string' || typeof entry.label !== 'string') return null;
    if (!isPhase(entry.phase)) return null;
    if (!entry.before || typeof entry.before !== 'object' || !entry.after || typeof entry.after !== 'object') return null;
    eventLog.push({
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
  if (!data.evidence || typeof data.evidence !== 'object') return null;
  const evidence = data.evidence as Record<string, unknown>;
  if (
    typeof evidence.experiencedFault !== 'boolean' ||
    typeof evidence.operatedMechanic !== 'boolean' ||
    typeof evidence.transferred !== 'boolean'
  ) {
    return null;
  }
  if (!data.modules || typeof data.modules !== 'object') return null;
  const modulesRaw = data.modules as Record<string, unknown>;
  const modules: SquadModules = {
    tactics: false,
    scouting: false,
    transfers: false,
    registration: false,
    ignoreRegistration: false,
    agent: false,
  };
  for (const id of MODULE_IDS) {
    if (typeof modulesRaw[id] !== 'boolean') return null;
    modules[id] = modulesRaw[id] as boolean;
  }
  if (!data.microChecks || typeof data.microChecks !== 'object') return null;
  const microChecksRaw = data.microChecks as Record<string, unknown>;
  if (typeof microChecksRaw.a !== 'boolean' || typeof microChecksRaw.b !== 'boolean') return null;
  const flags = [
    'fastPlay',
    'microTaught',
    'flowStarted',
    'counterfactualCorrect',
    'counterfactualAnswered',
    'reflectionConfirmed',
    'skippedReflection',
  ] as const;
  for (const key of flags) {
    if (typeof data[key] !== 'boolean') return null;
  }
  if (!Array.isArray(data.signings)) return null;
  const signings = data.signings.filter((id): id is string => typeof id === 'string');
  if (signings.length !== data.signings.length) return null;
  if (new Set(signings).size !== signings.length) return null;
  if (signings.some((id) => !CANDIDATE_SEEDS.some((candidate) => candidate.id === id))) return null;
  if (!isFiniteNumber(data.round) || data.round < 1) return null;
  if (!isFiniteNumber(data.restarts) || data.restarts < 0) return null;
  if (!isFiniteNumber(data.startTransferBudget) || data.startTransferBudget < 0) return null;
  if (!isFiniteNumber(data.startWageRoom) || data.startWageRoom < 0) return null;
  if (typeof data.clubConnected !== 'boolean') return null;
  if (!isFiniteNumber(data.clubFailures) || data.clubFailures < 0) return null;
  if (!isFiniteNumber(data.seed)) return null;
  const scouts = reviveScouts(data.scouts);
  if (!scouts) return null;
  const tactics = reviveTactics(data.tactics);
  if (!tactics) return null;
  const registration = data.registration === null ? null : reviveRegistration(data.registration);
  if (data.registration !== null && !registration) return null;

  return {
    version: SQUAD_STATE_VERSION,
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
    inheritedSignings,
    candidates,
    microChecks: { a: microChecksRaw.a, b: microChecksRaw.b },
    microTaught: data.microTaught as boolean,
    flowStarted: data.flowStarted as boolean,
    step: data.step,
    scouts,
    signings,
    round: Math.floor(data.round),
    tactics,
    tacticsPreset,
    registration,
    counterfactualCorrect: data.counterfactualCorrect as boolean,
    counterfactualAnswered: data.counterfactualAnswered as boolean,
    reflectionChoice: typeof data.reflectionChoice === 'string' ? data.reflectionChoice : null,
    reflectionConfirmed: data.reflectionConfirmed as boolean,
    skippedReflection: data.skippedReflection as boolean,
    restarts: data.restarts,
    startTransferBudget: data.startTransferBudget,
    startWageRoom: data.startWageRoom,
    clubConnected: data.clubConnected,
    clubFailures: Math.floor(data.clubFailures),
  };
}
