import type { LevelId } from '../game/engine/types';
import '../content/scene3d.css';

/**
 * 纯 CSS 3D 视觉层：不引入 three.js 或外部资源。
 * 所有场景都是装饰性的（aria-hidden），不承载必须阅读的信息，
 * 也不影响关卡状态与测试；在 prefers-reduced-motion 下停止动画。
 */

type PlayerDot = { x: number; y: number; side: 'home' | 'away' };

const HOME_PLAYERS: PlayerDot[] = [
  { x: 50, y: 91, side: 'home' },
  { x: 18, y: 74, side: 'home' },
  { x: 39, y: 77, side: 'home' },
  { x: 61, y: 77, side: 'home' },
  { x: 82, y: 74, side: 'home' },
  { x: 27, y: 54, side: 'home' },
  { x: 50, y: 58, side: 'home' },
  { x: 73, y: 54, side: 'home' },
  { x: 22, y: 32, side: 'home' },
  { x: 50, y: 27, side: 'home' },
  { x: 78, y: 32, side: 'home' },
  { x: 50, y: 10, side: 'away' },
  { x: 32, y: 22, side: 'away' },
  { x: 68, y: 22, side: 'away' },
  { x: 42, y: 40, side: 'away' },
  { x: 58, y: 40, side: 'away' },
];

const TACTICS_PLAYERS: PlayerDot[] = [
  { x: 50, y: 90, side: 'home' },
  { x: 16, y: 72, side: 'home' },
  { x: 38, y: 76, side: 'home' },
  { x: 62, y: 76, side: 'home' },
  { x: 84, y: 72, side: 'home' },
  { x: 30, y: 54, side: 'home' },
  { x: 50, y: 58, side: 'home' },
  { x: 70, y: 54, side: 'home' },
  { x: 22, y: 30, side: 'home' },
  { x: 50, y: 24, side: 'home' },
  { x: 78, y: 30, side: 'home' },
];

function PitchBoard({
  players,
  className = '',
  label,
}: {
  players: PlayerDot[];
  className?: string;
  label: string;
}) {
  return (
    <div className={`tabletop-pitch ${className}`} role="img" aria-label={label}>
      <span className="tp-line tp-half" />
      <span className="tp-circle" />
      <span className="tp-box tp-box-left" />
      <span className="tp-box tp-box-right" />
      <span className="tp-goal tp-goal-left" />
      <span className="tp-goal tp-goal-right" />
      {players.map((player, index) => (
        <span
          className={`tp-player is-${player.side}`}
          key={`${player.side}-${index}`}
          style={{ left: `${player.x}%`, top: `${player.y}%` }}
        />
      ))}
      <span className="tp-ball" />
    </div>
  );
}

export function StadiumScene() {
  return (
    <div className="scene-3d stadium-scene" aria-hidden="true">
      <div className="stadium-glow" />
      <div className="stadium-floor" />
      <div className="stadium-rig">
        <div className="stadium-base" />
        <PitchBoard players={HOME_PLAYERS} className="stadium-pitch" label="3D 战术板示意" />
      </div>

      <div className="scene-card scene-card-tactics">
        <span className="scene-card-tag">战术板</span>
        <strong>有球 4-3-3</strong>
        <em>套边 + 内收，拉开宽度</em>
      </div>
      <div className="scene-card scene-card-scout">
        <span className="scene-card-tag">球探报告</span>
        <strong>知识度 42%</strong>
        <em>“左脚，擅长内切，速度区间 78–85。”</em>
      </div>
      <div className="scene-card scene-card-transfer">
        <span className="scene-card-tag">转会报价</span>
        <strong>€18M + 周薪 €65k</strong>
        <em>预算与工资空间同时占用</em>
      </div>
      <span className="scene-chip">规则变化 → 决策变化</span>
    </div>
  );
}

function TacticsDiorama() {
  return (
    <div className="diorama-stage diorama-tactics">
      <div className="diorama-pitch-rig">
        <div className="diorama-base" />
        <PitchBoard players={TACTICS_PLAYERS} className="diorama-pitch" label="3D 站位示意" />
      </div>
      <span className="diorama-chip chip-possession">有球 4-3-3</span>
      <span className="diorama-chip chip-out">无球 4-4-2 中位块</span>
    </div>
  );
}

function ScoutingDiorama() {
  return (
    <div className="diorama-stage diorama-scouting">
      <div className="globe-rig">
        <div className="globe-shadow" />
        <div className="globe">
          <span className="globe-ring r1" />
          <span className="globe-ring r2" />
          <span className="globe-ring r3" />
          <span className="globe-pin pin-1" />
          <span className="globe-pin pin-2" />
          <span className="globe-pin pin-3" />
        </div>
      </div>
      <div className="diorama-card scout-report">
        <span>球探报告</span>
        <strong>78% 知识度</strong>
        <em>区间收窄中</em>
      </div>
      <span className="diorama-chip chip-knowledge">4 个区域 · 2 名球探</span>
    </div>
  );
}

function TransfersDiorama() {
  const coins = [0, 1, 2, 3, 4, 5];
  return (
    <div className="diorama-stage diorama-transfers">
      <div className="coin-rig">
        <div className="coin-stack">
          {coins.map((coin) => (
            <span className="coin" key={coin} style={{ transform: `translateZ(${coin * 7}px)` }} />
          ))}
          <span className="coin-top">€</span>
        </div>
        <div className="coin-shadow" />
      </div>
      <div className="diorama-card offer-card">
        <span>报价单</span>
        <strong>€22.8M</strong>
        <em>周薪 €160k · 兴趣 38/100</em>
      </div>
      <span className="diorama-chip chip-budget">预算 €45M · 工资 €350k</span>
    </div>
  );
}

function SquadDiorama() {
  const cards = [
    { pos: 'GK', label: '门将' },
    { pos: 'DF', label: '后卫' },
    { pos: 'MF', label: '中场' },
    { pos: 'FW', label: '前锋' },
    { pos: '★', label: '核心' },
  ];
  return (
    <div className="diorama-stage diorama-squad">
      <div className="fan-rig">
        {cards.map((card, index) => (
          <span className={`fan-card fan-${index}`} key={card.pos}>
            <b>{card.pos}</b>
            <em>{card.label}</em>
          </span>
        ))}
      </div>
      <div className="registration-ring">
        <span>25</span>
        <em>名单上限</em>
      </div>
      <span className="diorama-chip chip-registration">青训 8 · 本土 21/25</span>
    </div>
  );
}

const DIORAMA_LABELS: Record<LevelId, string> = {
  tactics: '3D 站位视窗',
  scouting: '3D 球探视窗',
  transfers: '3D 预算视窗',
  squad: '3D 名单视窗',
};

export function LevelDiorama({ levelId }: { levelId: LevelId }) {
  return (
    <div className={`level-diorama diorama-${levelId}`} aria-hidden="true">
      <div className="diorama-caption">
        <span>可视化视窗</span>
        <strong>{DIORAMA_LABELS[levelId]}</strong>
      </div>
      {levelId === 'tactics' && <TacticsDiorama />}
      {levelId === 'scouting' && <ScoutingDiorama />}
      {levelId === 'transfers' && <TransfersDiorama />}
      {levelId === 'squad' && <SquadDiorama />}
    </div>
  );
}
