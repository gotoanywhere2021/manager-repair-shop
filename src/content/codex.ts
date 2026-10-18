import type { LevelId, MechanismId } from '../game/engine/types';

/**
 * 「经理图鉴」卡内容。
 *
 * 四张卡讲的是足球经理类游戏里真实存在的系统结构，但全部文案、案例与数值
 * 都是本项目原创的简化原型，不使用真实俱乐部、球员或教练名称，
 * 也不复制任何商业游戏的界面、文本或规则表。
 */
export interface CodexCard {
  mechanismId: MechanismId;
  /** 中文名称，与 MECHANISM_NAMES 保持一致。 */
  zhName: string;
  /** 英文名称，与 MECHANISM_NAMES 保持一致。 */
  enName: string;
  /** 一句话定义。 */
  definition: string;
  /** 本关体验：玩家在本作里亲手做过的那一次。 */
  levelExperience: string;
  /** 决策结构：玩家实际在权衡什么。 */
  decisionStructure: string;
  /** 适用情况：什么目标下值得考虑这个系统。 */
  whenToUse: string;
  /** 常见误用：容易被错误使用或错误命名的情形。 */
  misuse: string;
  /** 可能的副作用：装上之后需要继续观察的问题。 */
  sideEffect: string;
  /** 可联动系统。 */
  synergies: string[];
  /** 解锁这张卡对应的委托关卡；“去完成委托”入口跳转到这里。 */
  levelId: LevelId;
}

export const CODEX_CARDS: CodexCard[] = [
  {
    mechanismId: 'tactics-shapes',
    zhName: '双形态战术',
    enName: 'In & Out of Possession',
    definition:
      '把一支球队在“有球”和“无球”两种阶段拆成两套站位与职责：有球时怎么推进、拉开与创造，无球时怎么压迫、保护与回收。',
    levelExperience:
      '在「战术板」里，你先用一套 4-4-2 打完整场：控球时边路人手不足，丢球后边后卫又回不来，对手反复从边路推进。装上双形态后，有球形态改成 4-3-3，无球形态回到 4-4-2 中位块，同一批球员在两种阶段执行不同任务，边路空当明显变小。',
    decisionStructure:
      '每一套形态都在权衡“现在多创造一点”与“丢球后少漏一点”：有球形态越激进、压上的人越多，无球形态要覆盖的空间就越大。职责设置（边后卫内收还是套边、后腰单人还是双人）决定了同一名球员在两种形态之间要跑多远、要做什么判断。',
    whenToUse:
      '想让同一批球员在攻守两端都有明确任务；想让对手的高位压迫或边路进攻有针对性解法；想用“阵型”而不是“士气”解释比赛里的得失。',
    misuse:
      '只把两套阵型的名字改掉，却沿用同一批职责与跑动指令，等于没装。另一种误用是把有球形态调得过于激进，却不给无球形态补位球员，转换阶段会被反复打穿。',
    sideEffect:
      '两套形态会增加训练与角色熟悉度成本；职责边界不清时，球员会在“压上”和“回收”之间犹豫，反而比一套简单阵型更容易脱节。',
    synergies: ['职责分工', '球员轮换', '球探报告', '转会谈判'],
    levelId: 'tactics',
  },
  {
    mechanismId: 'scout-network',
    zhName: '球探网络',
    enName: 'Scouting Network',
    definition:
      '用数量有限的球探覆盖不同区域，随着考察轮次积累知识度，把“完全不知道”逐步变成“可以判断”的报告。',
    levelExperience:
      '在「球探室」里，旧版本点一下就能看到所有候选的精确能力，挑选毫无难度。装上有限球探与知识度之后，你只有 2 名球探：派去哪个区域、派几轮、什么时候停止考察去谈转会，都会改变你最终看到的报告质量。',
    decisionStructure:
      '球探数量固定，所以每一次派遣都在回答：现在把球探放在哪个区域，还是留到下一轮？覆盖越广，单个区域的知识越浅；考察越深，越可能错过窗口。报告从来不是“真实能力”，而是“此刻值得相信多少”。',
    whenToUse:
      '想让招募建立在信息成本上；想让玩家在“看得多”和“看得准”之间做取舍；想给低价联赛、年轻球员或非主流区域留出发现空间。',
    misuse:
      '把球探当无限点击的搜索按钮，或者用精确数字假装信息完整。另一种误用是只考察已知的大牌，导致球探系统形同虚设。',
    sideEffect:
      '知识度太低时，报告会让人误判；考察过度又会错过转会窗口。球探覆盖不均时，俱乐部会长期看不见某些市场。',
    synergies: ['转会谈判', '双形态战术', '阵容注册', '球员轮换'],
    levelId: 'scouting',
  },
  {
    mechanismId: 'transfer-negotiation',
    zhName: '转会谈判',
    enName: 'Transfer Negotiation',
    definition:
      '在转会预算与工资空间的双重约束下，通过报价、等待与竞争完成签约；等待可能压低价格，也可能失去目标。',
    levelExperience:
      '在「转会窗」里，旧版本可以直接按身价买下任何人，预算和工资空间都不存在。装上预算与谈判后，你要在 3 轮窗口里决定先报价谁、报多高、要不要继续等：等到了更低价，也可能等来竞争对手。',
    decisionStructure:
      '每次报价都在权衡：现在锁定目标，还是再等一轮争取更好的价格？转会费和周薪要同时满足；把预算花在一名球星上，可能让第二个位置只剩底薪空间。窗口关闭时，“没签成”也是一种真实结果。',
    whenToUse:
      '想让招募有真实成本与竞争；想让玩家理解“预算”和“工资空间”不是同一个数字；想让等待本身成为一种风险决策。',
    misuse:
      '只看转会费不看周薪；把预算当成无限资源；或者把“等更便宜”当成无风险操作。另一个误用是只签总评最高的球员，忽略位置与战术适配。',
    sideEffect:
      '预算锁死会让后续补强没有空间；工资结构失衡会影响更衣室；过度等待可能让窗口结束时名单缺人。',
    synergies: ['球探网络', '阵容注册', '双形态战术', '球员轮换'],
    levelId: 'transfers',
  },
  {
    mechanismId: 'squad-registration',
    zhName: '阵容注册',
    enName: 'Squad Registration',
    definition:
      '把球员名单同时塞进多个约束：人数上限、本土青训名额、位置覆盖与工资空间；每名球员只能占用一次名额。',
    levelExperience:
      '在「赛季名单」里，你把球探、转会和战术拼到一起，却发现注册被打回：本土青训差 1 人、前锋堆了 4 个、工资超线。你必须回头调整转会目标，让名单同时满足比赛和注册规则。',
    decisionStructure:
      '每一次签约都在同时占用多个名额：一个外援前锋能提升即战力，却会挤掉青训名额和另一个位置的补强空间。注册规则让“收集强球员”变成“拼一张能过关的名单”。',
    whenToUse:
      '想让阵容构建有硬约束；想让本土青训、位置覆盖与工资结构真正影响转会；想让“凑齐”本身成为有代价的目标。',
    misuse:
      '只堆总评最高的球员，忽略配额与位置；或者为了凑青训名额塞进完全用不上的球员。另一种误用是只看人数上限，不看比赛里是否真的有人能踢。',
    sideEffect:
      '配额会迫使俱乐部提前规划青训与本土球员；位置冗余会造成更衣室不满；工资超线则可能让已经谈好的转会无法注册。',
    synergies: ['转会谈判', '球探网络', '双形态战术', '球员轮换'],
    levelId: 'squad',
  },
];

/** 按系统 id 取卡片；供界面与测试使用。 */
export function getCodexCard(mechanismId: MechanismId): CodexCard | undefined {
  return CODEX_CARDS.find((card) => card.mechanismId === mechanismId);
}

/** 未解锁卡片的统一提示，避免在锁定状态下提前剧透正文。 */
export const CODEX_LOCKED_HINT = '完成对应委托后解锁完整卡片。';
