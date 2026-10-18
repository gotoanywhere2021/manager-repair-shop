/**
 * 可序列化的伪随机数生成器（mulberry32）。
 *
 * 设计目标：
 * - 纯函数：输入旧状态，返回新状态与结果，不修改参数；
 * - 状态可以随存档序列化，恢复后随机序列从原处继续；
 * - 相同种子 + 相同动作序列得到相同结果（单元测试依赖这一点）。
 */

export interface RngState {
  /** 初始种子，仅用于展示与复盘。 */
  seed: number;
  /** 当前 32 位内部状态。 */
  state: number;
  /** 已抽取次数，用于调试与日志。 */
  calls: number;
}

export interface RngDraw {
  rng: RngState;
  value: number;
}

const UINT32 = 0x100000000;

function toUint32(value: number): number {
  return value >>> 0;
}

/** 把任意数字（含 NaN / 负数 / 小数）规整成一个 32 位无符号种子。 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1;
  const truncated = Math.trunc(seed) >>> 0;
  return truncated === 0 ? 1 : truncated;
}

export function createRng(seed: number): RngState {
  const normalized = normalizeSeed(seed);
  return { seed: normalized, state: normalized, calls: 0 };
}

/** 生成 [0, 1) 的浮点数。 */
export function nextUnit(rng: RngState): RngDraw {
  const state = toUint32(rng.state + 0x6d2b79f5);
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32;
  return { rng: { seed: rng.seed, state, calls: rng.calls + 1 }, value };
}

/** 以 probability（0~1）判定成功。概率为 0 时必然失败，为 1 时必然成功。 */
export function nextChance(rng: RngState, probability: number): RngDraw & { success: boolean } {
  const clamped = Math.min(1, Math.max(0, probability));
  const draw = nextUnit(rng);
  return { ...draw, success: draw.value < clamped };
}

/** 生成 [0, maxExclusive) 的整数。maxExclusive 必须为正整数。 */
export function nextInt(rng: RngState, maxExclusive: number): RngDraw {
  const max = Math.max(1, Math.floor(maxExclusive));
  const draw = nextUnit(rng);
  return { rng: draw.rng, value: Math.floor(draw.value * max) };
}

/** 用当前时间生成一个展示用随机种子。规则内部永远显式接收种子，便于复盘。 */
export function randomSeed(): number {
  return normalizeSeed(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
}

/** 从整数数组安全重建随机状态；损坏数据回退为新种子。 */
export function reviveRng(raw: unknown): RngState {
  if (raw && typeof raw === 'object') {
    const candidate = raw as Partial<RngState>;
    if (
      typeof candidate.seed === 'number' &&
      typeof candidate.state === 'number' &&
      typeof candidate.calls === 'number' &&
      Number.isFinite(candidate.seed) &&
      Number.isFinite(candidate.state) &&
      Number.isFinite(candidate.calls) &&
      candidate.calls >= 0
    ) {
      return {
        seed: normalizeSeed(candidate.seed),
        state: toUint32(candidate.state),
        calls: Math.floor(candidate.calls),
      };
    }
  }
  return createRng(1);
}

export function isRngState(raw: unknown): raw is RngState {
  return (
    !!raw &&
    typeof raw === 'object' &&
    typeof (raw as RngState).seed === 'number' &&
    typeof (raw as RngState).state === 'number' &&
    typeof (raw as RngState).calls === 'number'
  );
}
