import type { LevelId, MechanismId } from '../game/engine/types';

/**
 * 机制原理馆内容。
 *
 * 这些文字是对《桌面游戏设计的基石：机制百科全书》中机制分类与设计问题的原创中文概括，
 * 用于解释本作四个系统背后的设计原理；不复制原书正文、图表或扫描图片，也不标注页码。
 * 机制编号（如 ACT-02、WPL-01）只用于定位书目中的机制条目，方便读者自行查阅。
 */

export interface KnowledgeBookRef {
  /** 书目中的机制编号；没有编号时省略。 */
  code?: string;
  /** 机制名称（沿用书目中的中文译名，便于对照）。 */
  name: string;
  /** 所属主题章节（只写主题名，不写页码）。 */
  chapter: string;
}

export interface KnowledgeSection {
  heading: string;
  body: string;
  bullets?: string[];
}

export interface KnowledgeTopic {
  id: string;
  title: string;
  english: string;
  levelId?: LevelId;
  tagline: string;
  summary: string;
  sections: KnowledgeSection[];
  designQuestions: string[];
  pitfalls: string[];
  bookRefs: KnowledgeBookRef[];
}

export interface FoundationTopic {
  id: string;
  title: string;
  english: string;
  summary: string;
  principle: string;
  inThisGame: string;
  bookRefs: KnowledgeBookRef[];
}

export interface GlossaryEntry {
  term: string;
  english: string;
  definition: string;
}

export const BOOK_REFERENCE = {
  title: '桌面游戏设计的基石：机制百科全书',
  originalTitle: 'Building Blocks of Tabletop Game Design: An Encyclopedia of Mechanisms',
  authors: 'Geoffrey Engelstein、Isaac Shalev',
  chineseEdition: '机械工业出版社，2024 年中文版',
  isbn: '978-7-111-76771-8',
  copyrightNote:
    '本书英文原版 © 2020 Taylor & Francis Group, LLC，中文版由机械工业出版社出版发行。本页只做原创概括与教学讨论，不复制原书正文、图表或扫描图片，也不代表作者或出版方的推荐与授权。',
  methodNote:
    '书目的价值不在于给出一套必须遵守的规则，而在于把桌游拆成一盒可以组合、比较、替换的设计积木。本作借用的是这种拆解方式。',
};

export const KNOWLEDGE_LEVEL_TOPICS: KnowledgeTopic[] = [
  {
    id: 'level-tactics',
    title: '双形态战术：把“阶段”变成两套规则',
    english: 'In & Out of Possession as constrained role configuration',
    levelId: 'tactics',
    tagline: '同一批球员，在不同阶段承担不同任务。',
    summary:
      '双形态战术不是桌游里的某一个单一机制，而是把「行动选择限制」和「可变角色配置」组合起来：有球和无球各有一套站位与职责，玩家只能在有限选项里做取舍。真正让选择有重量的不是选项数量，而是每个选项都会牺牲另一种能力。',
    sections: [
      {
        heading: '规则层：两套形态 + 两个职责',
        body:
          '有球形态负责推进与创造，无球形态负责保护与压迫；两名球员的职责（边后卫套边/内收、后腰单/双）再把两套形态落到具体位置。规则把可选动作限制在少数几个组合里，这正是「行动选择限制」的核心：不是给玩家无限自由，而是让每一个选择都排除别的选择。',
        bullets: [
          '有球形态越激进，推进越强，但丢球后要覆盖的空间更大。',
          '职责越靠前，控球收益越高，回防距离与体能代价也越大。',
          '阵型与职责组合之后，玩家还要为每个比赛阶段选择一条指令，形成“配置 + 临场”的两层决策。',
        ],
      },
      {
        heading: '决策层：为什么“全都想要”不可行',
        body:
          '如果没有体能上限、没有对手倾向、没有阶段差异，最佳配置会被一次算出来。设计用三个约束制造取舍：可选形态有限、职责互斥、体能是共同代价。这样玩家的判断就从“哪个数字最大”变成“我愿意牺牲什么，去换哪一段时间的优势”。',
      },
      {
        heading: '体验层：紧张感来自代价，而不是随机',
        body:
          '这套结构的体验目标是“为下一阶段留余地”。玩家在控球时投入多少、在无球时保护哪一侧，都会改变之后的处境。失败不是被骰子惩罚，而是因为自己在某个阶段的配置暴露了代价。迁移到另一支球队时，玩家要能识别出「有球形态 / 无球形态 / 职责分工」三样东西，才算真的理解了结构。',
      },
      {
        heading: '设计变体与代价',
        body:
          '如果把选项做成十几套阵型，玩家容易陷入分析瘫痪；如果职责效果不可见，选择会退化成猜；如果只改数值、不改站位结构，玩家会觉得“换了名字但没换游戏”。反过来说，减少选项、强化可视反馈、让代价立刻可见，往往比继续加内容更能提高决策质量。',
      },
    ],
    designQuestions: [
      '玩家在每个阶段真正要决定的是什么？',
      '每个选项排除了什么？它的代价是否可见？',
      '如果玩家可以随时改配置，取舍还存在吗？',
      '哪些信息应该公开，哪些应该让玩家自己观察？',
    ],
    pitfalls: [
      '只增加选项数量，不增加取舍。',
      '把“正确配置”直接告诉玩家，让实验变成执行。',
      '用随机结果替代结构性的代价。',
    ],
    bookRefs: [
      { code: 'ACT-02', name: '行动选取（Action Drafting）', chapter: '行动' },
      { code: 'ACT-11', name: '行动选择限制（Action Selection Restrictions）', chapter: '行动' },
      { code: 'ACT-12', name: '可变玩家能力（Variable Player Powers）', chapter: '行动' },
    ],
  },
  {
    id: 'level-scouting',
    title: '球探网络：把“信息”做成有限资源',
    english: 'Worker placement + hidden information',
    levelId: 'scouting',
    tagline: '球探不是搜索按钮，而是需要分配的有限行动。',
    summary:
      '球探室把两类桌游机制叠在一起：工人放置（有限工人放到互斥行动格、轮末收回）与隐藏/未知信息（信息不是一次性给全，而是逐步揭示）。玩家真正分配的不是“点击次数”，而是“要覆盖多大范围、要挖多深、什么时候停止考察去谈判”。',
    sections: [
      {
        heading: '工人放置的三要素',
        body:
          '标准工人放置通常包含：数量有限的工人、互斥的行动格、回合结束回收。三者缺一，机制就会退化。球探室保留了这三件事：每轮两名球探、每个区域每轮最多一名、轮末收回；同时把“行动格”换成了“区域”，让主题与规则对上。',
        bullets: [
          '有限工人：每轮只能派两名，覆盖范围天然受限。',
          '行动空间占用：同一区域不能重复派遣，后手会失去机会。',
          '回收：轮末球探回到手中，下一轮重新选择，而不是永久锁死。',
        ],
      },
      {
        heading: '信息作为一种资源',
        body:
          '隐藏信息与未知信息的区别很重要：隐藏信息是“有人知道但你不知道”，未知信息是“还没有人知道”。球探室更接近后者：知识度从 0 开始，报告从模糊区间逐步变窄。获得信息需要花费行动，而信息又会改变后续决策，所以信息本身就成了资源。',
        bullets: [
          '低知识度：只能看到很宽的区间，判断空间大。',
          '高知识度：区间收窄，但仍不等于精确值。',
          '“只看集锦”是一种便宜但不可靠的信息来源，用确定性换风险。',
        ],
      },
      {
        heading: '体验层：覆盖还是深耕',
        body:
          '玩家每轮只有两名球探，于是必须回答：把球探放在哪、放几轮、什么时候停止考察去锁定目标。覆盖越广，单个区域知识越浅；考察越深，越可能错过窗口。这个权衡是工人放置与信息机制结合后自然长出来的，不需要额外加规则。',
      },
      {
        heading: '设计变体与代价',
        body:
          '如果球探无限，机制变成“点按钮”；如果报告一上来就是精确数字，判断变成算术；如果区域容量无限，卡位与后手压力就消失。反过来，也可以加入球探专长、报告冲突、知识衰减等变体，但每加一层，都要问它是否让“信息成本”更清楚，而不是让界面更复杂。',
      },
    ],
    designQuestions: [
      '信息是免费的、昂贵的，还是无法获得的？',
      '玩家能否判断一条信息有多可信？',
      '覆盖范围与考察深度的取舍在哪里？',
      '如果取消工人/行动格限制，体验会变成什么样？',
    ],
    pitfalls: [
      '用“精确数字”替代“不完整信息”，消灭判断。',
      '让球探可以无限重复使用，机制退化成按钮。',
      '只做区域占用，却没有轮末回收与后续选择。',
    ],
    bookRefs: [
      { code: 'WPL-01', name: '标准工人放置（Standard Worker Placement）', chapter: '工人放置' },
      { code: 'WPL-05', name: '增减建筑物数量（Adding and Blocking Buildings）', chapter: '工人放置' },
      { code: 'UNC-07', name: '未知信息（Unknown Information）', chapter: '不确定性' },
      { code: 'UNC-08', name: '隐藏信息（Hidden Information）', chapter: '不确定性' },
    ],
  },
  {
    id: 'level-transfers',
    title: '转会窗：拍卖、谈判与预算的三重约束',
    english: 'Auction + negotiation under budgets',
    levelId: 'transfers',
    tagline: '报价是在表达估值，等待是在让市场说话。',
    summary:
      '转会窗的核心不是“买谁”，而是“在什么时间、用什么价格、承担多大竞争风险去锁定谁”。它借用了拍卖机制里的估值与竞争、谈判机制里的承诺与等待，以及经济机制里的双重预算约束。三者叠在一起，才让每一次报价都有代价。',
    sections: [
      {
        heading: '拍卖视角：报价就是估值',
        body:
          '拍卖机制最核心的问题不是“谁出价最高”，而是“玩家如何估计拍卖品的价值”。转会窗里，身价、周薪、经纪人佣金、竞争对手兴趣共同构成估值环境；玩家对目标的真实价值判断越模糊，报价越像一场带信息的博弈。',
        bullets: [
          '竞争兴趣可以看作其他俱乐部的估值信号。',
          '等待可能压低要价，也可能让竞争对手进场。',
          '高价保证成交，但会让你支付超过估值的溢价。',
        ],
      },
      {
        heading: '谈判视角：等待与承诺',
        body:
          '谈判机制区分“有约束力的承诺”和“没有约束力的口头承诺”。转会窗把复杂的还价简化成了报价档位与等待：你只能选择现在锁定，或继续等一个更好的价格。等待不是免费的，它把谈判时间变成了风险。',
      },
      {
        heading: '经济视角：两个预算，一个球员',
        body:
          '转会费与周薪是两套独立的硬约束。签下一名球员会同时占用两个预算，所以“总预算”不是简单相加；一次大额签约可能让后续位置只剩底薪空间。经济机制里的稀缺、机会成本与资源转换，在这里体现得非常直接。',
      },
      {
        heading: '体验层：窗口关闭前的取舍',
        body:
          '转会窗的戏剧性来自时间压力与错过。玩家必须在不完全信息下决定何时停止等待；错过目标不是失败，而是“等待策略”的真实结果。好的设计会让玩家在窗口结束后能复盘：是估值错了、预算错了，还是等待太久。',
      },
    ],
    designQuestions: [
      '玩家如何判断一个目标值多少钱？',
      '等待的收益和风险分别是什么？',
      '预算约束是硬的还是软的？它如何改变优先级？',
      '竞争信息应该公开、部分公开，还是完全隐藏？',
    ],
    pitfalls: [
      '只限制转会费，不限制工资，预算就变成单一维度。',
      '等待没有任何成本，玩家会永远等下去。',
      '成功率阈值不透明，玩家无法从失败中学习。',
    ],
    bookRefs: [
      { code: 'AUC-04', name: '投标拍卖（Sealed-Bid Auction）', chapter: '拍卖' },
      { code: 'AUC-06', name: '限制性竞标（Constrained Bidding）', chapter: '拍卖' },
      { code: 'AUC-08', name: '荷式拍卖（Dutch Auction）', chapter: '拍卖' },
      { code: 'ECO-05', name: '收入（Income）', chapter: '经济' },
      { code: 'ECO-18', name: '谈判（Negotiation）', chapter: '经济' },
    ],
  },
  {
    id: 'level-squad',
    title: '赛季名单：成套收集与约束满足',
    english: 'Set collection under registration constraints',
    levelId: 'squad',
    tagline: '名单不是把最强的人加起来，而是拼一张能注册的名单。',
    summary:
      '阵容注册把成套收集与约束满足放在一起：每名球员只占一个名额，青训、位置、人数、工资同时约束；同一套球员的组合价值不等于单件价值相加。玩家必须在“质量、配额、位置、预算”之间做多目标取舍，这就是它比单纯收集更难的地方。',
    sections: [
      {
        heading: '成套收集：价值来自组合',
        body:
          '成套收集的关键设计问题是：什么算一套、每套值多少、套装之间是否互斥、收集广度与深度如何取舍。阵容注册的“套”不是简单的同色三张，而是位置覆盖、青训名额与战术适配的组合；每名球员只能参与一次，所以补齐一个缺口可能会拆掉另一个组合。',
        bullets: [
          '单件价值与组合价值分离：高总评球员不一定让名单更强。',
          '边际价值递减：同位置堆人，越堆越不值。',
          '缺口会改变优先级：差一名青训，会让一个普通球员变得关键。',
        ],
      },
      {
        heading: '约束满足：让“凑齐”有代价',
        body:
          '如果没有注册规则，最优解就是收集总评最高的球员；加上人数、青训、位置与工资约束后，玩家必须同时满足多个条件。约束不是装饰，它改变了每一次转会的价值判断，也让“放弃某个球星”成为合理决策。',
      },
      {
        heading: '组合能力：位置之间的化学反应',
        body:
          '桌游里的组合能力机制强调“特定组合产生额外效果”。阵容注册借用这个思路：不同位置、不同职责的球员组合会影响战术执行，而不仅仅是总评相加。玩家要考虑的从“这个人多强”变成“这套人能不能一起踢”。',
      },
      {
        heading: '体验层：从收集到规划',
        body:
          '好的成套收集会让玩家在收集过程中不断重新评估目标。注册检查表、缺口提示与实时校验器，都是为了让玩家看到“还差什么”，从而把注意力从“抽到好牌”转移到“如何规划名单”。',
      },
    ],
    designQuestions: [
      '什么算一套？套的大小与奖励如何影响行为？',
      '成套条件是否互斥？玩家是否需要放弃某些组合？',
      '约束是否可见？玩家能否提前规划？',
      '组合奖励是否强到让单件价值失去意义？',
    ],
    pitfalls: [
      '只看总评，不看位置与配额。',
      '套装奖励过强，玩家只会机械按表收集。',
      '约束不可见，注册失败变成突然袭击。',
    ],
    bookRefs: [
      { code: 'SET-01', name: '成套估值（Set Valuation）', chapter: '成套收集' },
      { code: 'SET-05', name: '组合能力（Combo Abilities）', chapter: '成套收集' },
      { code: 'VIC-11', name: '完成目标（Completing Targets）', chapter: '游戏结束与胜利' },
      { code: 'ACT-11', name: '行动选择限制（Action Selection Restrictions）', chapter: '行动' },
    ],
  },
];

export const KNOWLEDGE_FOUNDATIONS: FoundationTopic[] = [
  {
    id: 'foundation-mechanism',
    title: '机制是体验的骨架',
    english: 'Mechanisms as building blocks',
    summary:
      '机制是游戏里可被识别、比较和替换的规则构件。同一个机制，换一组参数、主题与玩家数量，可能产生完全不同的体验；反过来，同一个主题也可以由不同机制支撑。',
    principle:
      '分析游戏时，先问“这条规则让玩家做了什么决定”，而不是“它叫什么名字”。机制名称只是索引，真正决定体验的是决策结构、约束、信息与反馈。',
    inThisGame:
      '本作把足球经理的四个系统拆成可维修的构件：战术配置、球探网络、转会谈判、阵容注册。每一关只改一个结构，让玩家看到“规则变化 → 决策变化”。',
    bookRefs: [{ name: '机制作为设计积木（导论）', chapter: '导论' }],
  },
  {
    id: 'foundation-actions',
    title: '行动选择与限制',
    english: 'Action drafting & selection restrictions',
    summary:
      '行动选择是玩家从一组可选行动中挑一个；行动选择限制则是通过资源、格位、次数或前置条件，让某些行动互相排斥。没有限制，选择就退化成“选收益最高的按钮”。',
    principle:
      '真正有意义的选择至少需要三件事：多个可行选项、选项之间不能兼得、代价可以被玩家理解。限制越清晰，取舍越可学习。',
    inThisGame:
      '战术板用两个模块槽位、有限阵型与职责、体能上限限制选择；球探室用有限球探与区域容量限制行动；转会窗用预算与窗口限制报价。',
    bookRefs: [
      { code: 'ACT-02', name: '行动选取（Action Drafting）', chapter: '行动' },
      { code: 'ACT-11', name: '行动选择限制（Action Selection Restrictions）', chapter: '行动' },
    ],
  },
  {
    id: 'foundation-worker',
    title: '工人放置与卡位',
    english: 'Worker placement & blocking',
    summary:
      '玩家把有限数量的工人放到互斥的行动格上，执行行动的同时阻止别人使用同一格；回合结束收回工人。它把“选择行动”变成“分配稀缺的行动机会”。',
    principle:
      '工人放置的体验重点通常在“卡位”与“顺序”，而不只是执行行动。格位收益差、先手优势、回收节奏都会改变玩家行为；主题与机制的贴合程度决定玩家能否快速理解规则。',
    inThisGame:
      '球探室的两名球探、四个区域、每区域每轮一人、轮末收回，是典型的工人放置结构；主题换成了球探派遣，让“占用”与“覆盖”有直觉对应。',
    bookRefs: [
      { code: 'WPL-01', name: '标准工人放置（Standard Worker Placement）', chapter: '工人放置' },
      { code: 'WPL-05', name: '增减建筑物数量（Adding and Blocking Buildings）', chapter: '工人放置' },
    ],
  },
  {
    id: 'foundation-information',
    title: '信息、隐藏与未知',
    english: 'Hidden & unknown information',
    summary:
      '信息机制关心“谁知道什么、什么时候知道、知道得有多准”。隐藏信息是有人知道但不公开；未知信息是还没有人知道；两者都会改变决策的可计算程度。',
    principle:
      '信息不是越多越好。完全信息会让游戏变成计算题；完全随机会让决策失去意义。好的设计让玩家为信息付出成本，并能判断信息的可信度。',
    inThisGame:
      '球探室的知识度从模糊到精确，报告只给区间；转会窗的竞争兴趣与要价变化也只提供部分信息，玩家必须在不完全信息下决定是否等待。',
    bookRefs: [
      { code: 'UNC-07', name: '未知信息（Unknown Information）', chapter: '不确定性' },
      { code: 'UNC-08', name: '隐藏信息（Hidden Information）', chapter: '不确定性' },
    ],
  },
  {
    id: 'foundation-risk',
    title: '随机性与拼运气',
    english: 'Randomness & push-your-luck',
    summary:
      '随机性可以放在行动之前（输入随机）或结果之后（输出随机）。拼运气是特殊的一类：玩家可以反复选择继续还是停止，继续会提高收益，也可能失去已有成果。',
    principle:
      '风险决策要成立，玩家必须能估计概率与损失，并且有“主动停止”的动作。失败代价过高会让玩家永远停止，代价过低会让继续变成无脑选择。',
    inThisGame:
      '本作的返工成本把“验证失败”变成真实损失；转会窗的等待与竞争兴趣构成了另一种“继续还是锁定”的风险决策。',
    bookRefs: [{ code: 'UNC-02', name: '拼运气（Push-Your-Luck）', chapter: '不确定性' }],
  },
  {
    id: 'foundation-economy',
    title: '经济、预算与资源转换',
    english: 'Economy & budgets',
    summary:
      '经济机制处理资源如何产生、如何消耗、如何转换。收入、贷款、交换、预算上限与机会成本，都会改变玩家对同一资源的估值。',
    principle:
      '只要资源稀缺，玩家就必须排序。多重预算（例如转会费与工资）会让“总价”失去意义，迫使玩家同时考虑短期支出与长期结构。',
    inThisGame:
      '转会窗同时限制转会预算与周薪空间；返工成本从转会预算扣除，导致前期失败会影响后续关卡的可用资源。',
    bookRefs: [
      { code: 'ECO-05', name: '收入（Income）', chapter: '经济' },
      { code: 'ECO-01', name: '交换（Exchanging）', chapter: '经济' },
    ],
  },
  {
    id: 'foundation-auction',
    title: '拍卖与估值',
    english: 'Auctions & valuation',
    summary:
      '拍卖用竞争决定价格。不同拍卖形式（公开、密封、荷式、限制性竞标）在速度、信息与公平性上各有取舍；共同难点是玩家如何估计拍卖品价值。',
    principle:
      '拍卖品对每个人的价值不应完全相同，否则出价会退化成算术。隐藏目标、组合价值、未来不确定性，都是让估值有差异的手段。',
    inThisGame:
      '转会窗把“报价—等待—竞争”做成简化拍卖：要价会变化、对手兴趣会累积、高价保证成交但可能溢价。',
    bookRefs: [
      { code: 'AUC-04', name: '投标拍卖（Sealed-Bid Auction）', chapter: '拍卖' },
      { code: 'AUC-06', name: '限制性竞标（Constrained Bidding）', chapter: '拍卖' },
      { code: 'AUC-08', name: '荷式拍卖（Dutch Auction）', chapter: '拍卖' },
    ],
  },
  {
    id: 'foundation-negotiation',
    title: '谈判与承诺',
    english: 'Negotiation & commitment',
    summary:
      '谈判机制让玩家通过承诺、威胁或交易影响他人行动。关键区别是承诺是否有约束力，以及谈判是否占用游戏时间。',
    principle:
      '非约束性承诺会带来情绪与诚信风险；约束性承诺更容易规则化，但会降低谈判空间。谈判时间需要限制，否则会拖慢所有人。',
    inThisGame:
      '转会窗没有复杂的多人谈判，而是把“等待”理解为一次有风险的承诺：你现在不报价，就要承担竞争对手进场的后果。',
    bookRefs: [
      { code: 'ECO-18', name: '谈判（Negotiation）', chapter: '经济' },
      { code: 'ECO-02', name: '交易（Trading）', chapter: '经济' },
    ],
  },
  {
    id: 'foundation-sets',
    title: '成套收集与组合价值',
    english: 'Set collection & combos',
    summary:
      '成套收集让单件物品的价值取决于它与哪些其他物品组合。套的定义、套的大小、套之间的互斥与收集难度，决定了玩家的收集策略。',
    principle:
      '成套收集的张力来自“广度与深度”：收集更多种类可以凑套，收集同一类可能更快但价值更低。每件物品只能参与一套，会迫使玩家做取舍。',
    inThisGame:
      '阵容注册把 25 人名单当成一套约束满足题：位置覆盖、青训名额、工资与人数共同决定每名球员的价值；每名球员只占一个名额。',
    bookRefs: [
      { code: 'SET-01', name: '成套估值（Set Valuation）', chapter: '成套收集' },
      { code: 'SET-05', name: '组合能力（Combo Abilities）', chapter: '成套收集' },
    ],
  },
  {
    id: 'foundation-combination',
    title: '机制组合与主题整合',
    english: 'Combining mechanisms',
    summary:
      '桌游很少只用一个机制。多个机制叠加时，可能出现协同（互相放大）、冗余（做同一件事）或冲突（互相抵消）。主题则决定玩家能否理解这些规则为什么存在。',
    principle:
      '组合设计的关键不是“加更多机制”，而是让每个机制承担不同职责，并让玩家能看出它们之间的联系。主题贴合会显著降低学习成本。',
    inThisGame:
      '毕业关同时使用战术、球探、转会与注册：球探决定信息，转会决定资源与人员，注册决定名单合规，战术决定比赛用途。四个机制各司其职，而不是重复“花钱买人”。',
    bookRefs: [{ name: '机制组合（导论）', chapter: '导论' }],
  },
];

export const KNOWLEDGE_ANATOMY = [
  {
    step: '规则',
    title: '写下玩家能做什么',
    body:
      '以战术板为例：两套阵型、两个职责槽、每阶段一条指令、有限体能。规则先界定行动空间——玩家不能同时拥有所有能力。',
  },
  {
    step: '选择',
    title: '找出真正的取舍',
    body:
      '有球形态越激进，无球保护越差；职责越靠前，回防距离越长。每个选择都在交换两种能力，而不是简单地“选更好的”。',
  },
  {
    step: '信息',
    title: '玩家知道多少',
    body:
      '对手倾向公开，结果有少量波动；玩家能计算风险，但不能保证结果。信息公开程度决定了这关是计算题还是赌注。',
  },
  {
    step: '体验',
    title: '紧张感从哪里来',
    body:
      '返工要花俱乐部的钱，失败会真实影响后续预算。代价让“多试一次”变得有重量，玩家开始为不同阶段留余地。',
  },
  {
    step: '迁移',
    title: '换一个情境还成立吗',
    body:
      '把同样的结构搬到另一支球队或另一种阵型，玩家仍能识别有球形态、无球形态与职责分工，才算掌握机制而不是背答案。',
  },
];

export const KNOWLEDGE_GLOSSARY: GlossaryEntry[] = [
  { term: '机制', english: 'Mechanism', definition: '游戏里可识别、可比较、可替换的规则构件，例如工人放置、拍卖、成套收集。' },
  { term: '规则', english: 'Rules', definition: '机制的具体实现：回合怎么走、动作怎么结算、什么条件会触发什么结果。' },
  { term: '动力学', english: 'Dynamics', definition: '规则运行后玩家之间形成的互动模式，例如抢位、追赶、僵持、联盟。' },
  { term: '体验', english: 'Experience', definition: '玩家实际感受到的紧张、选择、成就感；它是机制运行的结果，而不是规则本身。' },
  { term: '决策空间', english: 'Decision space', definition: '玩家在当前局面下所有可行选择及其后果的总和；空间越大不一定越好，可读性更重要。' },
  { term: '约束', english: 'Constraint', definition: '限制玩家选择的条件，例如资源上限、行动次数、位置容量、时间窗口。' },
  { term: '取舍', english: 'Trade-off', definition: '获得一种收益必须放弃另一种收益；没有取舍的选择通常不构成真正的决策。' },
  { term: '信息不完全', english: 'Imperfect information', definition: '玩家无法掌握全部相关信息，必须根据已知部分做判断。' },
  { term: '隐藏信息', english: 'Hidden information', definition: '有人知道但不公开的信息，例如秘密目标、对手手牌、隐藏身份。' },
  { term: '未知信息', english: 'Unknown information', definition: '还没有人知道的信息，例如尚未揭示的地图、未考察球员的真实能力。' },
  { term: '随机性', english: 'Randomness', definition: '结果不完全由玩家决定；可以是输入随机（行动前的抽取）或输出随机（行动后的判定）。' },
  { term: '概率管理', english: 'Probability management', definition: '玩家通过选择、资源投入或信息获取来改变概率与风险，而不是被动接受随机。' },
  { term: '拼运气', english: 'Push-your-luck', definition: '玩家可以反复选择继续或停止；继续提高收益，也可能失去已有成果。' },
  { term: '工人放置', english: 'Worker placement', definition: '把有限工人放到互斥行动格，执行行动并阻止他人使用同一格，回合结束回收。' },
  { term: '行动选取', english: 'Action drafting', definition: '玩家从一组行动中选择一个执行；与工人放置同构，但主题与限制方式不同。' },
  { term: '行动选择限制', english: 'Action selection restrictions', definition: '通过次数、资源、前置条件或互斥关系限制玩家可选择的行动。' },
  { term: '拍卖', english: 'Auction', definition: '用竞争出价决定资源归属与价格；不同拍卖形式在信息、速度与公平性上不同。' },
  { term: '密封投标', english: 'Sealed-bid auction', definition: '所有玩家同时秘密出价，再统一揭晓；速度快，但缺少公开加价的信息交流。' },
  { term: '荷式拍卖', english: 'Dutch auction', definition: '价格从高到低下降，第一个接受当前价格的玩家获得拍卖品。' },
  { term: '谈判', english: 'Negotiation', definition: '玩家通过承诺、威胁或协商影响彼此行动；承诺是否有约束力是核心设计选择。' },
  { term: '预算', english: 'Budget', definition: '玩家可支配资源的硬上限；多重预算会让资源之间不能简单互换。' },
  { term: '资源转换', english: 'Resource conversion', definition: '用一种资源换取另一种资源，例如用转会费换球员、用工资空间换即战力。' },
  { term: '成套收集', english: 'Set collection', definition: '单件物品的价值取决于与其他物品的组合；套的定义与互斥关系决定收集策略。' },
  { term: '组合能力', english: 'Combo abilities', definition: '特定组件组合在一起时产生额外效果，鼓励玩家围绕组合规划。' },
  { term: '反馈循环', english: 'Feedback loop', definition: '玩家行动改变局势，局势又影响后续行动；正反馈放大领先，负反馈帮助追赶。' },
  { term: '落后追赶', english: 'Catch the leader', definition: '让落后玩家获得额外机会或资源的机制，用来缓解领先优势。' },
  { term: '主题整合', english: 'Theme integration', definition: '规则与主题相互解释的程度；主题贴合能降低学习成本并增强代入感。' },
  { term: '机制组合', english: 'Mechanism combination', definition: '多个机制叠加形成的整体系统；需要避免冗余、冲突与不可读。' },
  { term: '可读性', english: 'Legibility', definition: '玩家能否理解自己的选择会带来什么后果；可读性比复杂度更影响体验。' },
  { term: '分析瘫痪', english: 'Analysis paralysis', definition: '选项过多或后果难以估计，导致玩家长时间无法决策。' },
];

export const KNOWLEDGE_CHECKLIST = [
  '玩家每回合在决定什么？有多少选项真正不同？',
  '每个选择的代价是什么：资源、时机、信息，还是关系？',
  '玩家能估计结果吗？随机发生在行动前还是行动后？',
  '信息是公开、隐藏还是未知？获取信息需要付出什么？',
  '机制之间是协同、冗余，还是互相打架？',
  '主题是否帮助理解规则？规则是否支持主题承诺？',
  '如果移除一个机制，体验会明显改变吗？如果不变，它可能只是装饰。',
  '新玩家第一次玩时，会在哪一步卡住？',
];

export const KNOWLEDGE_FOR_LEVEL: Record<LevelId, string> = {
  tactics: 'level-tactics',
  scouting: 'level-scouting',
  transfers: 'level-transfers',
  squad: 'level-squad',
};

export const KNOWLEDGE_FOR_MECHANISM: Record<MechanismId, string[]> = {
  'tactics-shapes': ['level-tactics', 'foundation-actions', 'foundation-combination'],
  'scout-network': ['level-scouting', 'foundation-worker', 'foundation-information'],
  'transfer-negotiation': ['level-transfers', 'foundation-auction', 'foundation-economy'],
  'squad-registration': ['level-squad', 'foundation-sets', 'foundation-actions'],
};

export function getKnowledgeTopic(topicId: string): KnowledgeTopic | undefined {
  return KNOWLEDGE_LEVEL_TOPICS.find((topic) => topic.id === topicId);
}

export function getFoundation(topicId: string): FoundationTopic | undefined {
  return KNOWLEDGE_FOUNDATIONS.find((topic) => topic.id === topicId);
}
