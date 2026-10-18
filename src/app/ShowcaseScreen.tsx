import { useApp } from './AppContext';
import { Button, Chip, Meter } from '../components/Ui';
import { getLevel } from '../game/levels';
import {
  SHOWCASE_SEED,
  SHOWCASE_STEPS,
  SHOWCASE_TOTAL_STEPS,
  isShowcaseStepDone,
  showcaseOptionsFor,
} from '../content/showcaseSteps';
import type { ShowcaseStep, ShowcaseTarget } from '../content/showcaseSteps';
import '../content/showcase.css';

/**
 * 展示模式：8 步固定流程。
 *
 * 所有跳转都走 startLevel(..., { showcase: true, showcaseOptions })，
 * 因此不会读写正式进度；演示得分只存在内存中的 demo 里，刷新即重置。
 * 每一步都可以单独点击，不要求按顺序完成，也不要求正式通关。
 */
export function ShowcaseScreen() {
  const { demo, markDemoStep, resetDemo, startLevel, navigate } = useApp();
  const doneCount = SHOWCASE_STEPS.filter((step) => isShowcaseStepDone(step, demo)).length;
  const percent = Math.round((doneCount / SHOWCASE_TOTAL_STEPS) * 100);

  function handleBackHome() {
    navigate({ kind: 'home' }, 'normal');
  }

  function openLevel(step: ShowcaseStep, target: ShowcaseTarget) {
    // 先记录本步，再进入关卡；即使关卡组件还没实现完整流程，演示进度也能推进。
    markDemoStep(step.id);
    startLevel(target.levelId, {
      showcase: true,
      showcaseOptions: showcaseOptionsFor(target),
    });
  }

  function openCodex(step: ShowcaseStep) {
    markDemoStep(step.id);
    navigate({ kind: 'codex' }, 'showcase');
  }

  function markIntro(step: ShowcaseStep) {
    markDemoStep(step.id);
  }

  return (
    <div className="page showcase-page">
      <button type="button" className="back-link" onClick={handleBackHome}>
        <span aria-hidden="true">←</span> 返回修理铺
      </button>

      <header className="page-header">
        <p className="eyebrow">演示流程 · 约 5 分钟</p>
        <h1 className="page-title">展示模式</h1>
        <p className="page-lead">
          给评委或朋友演示时，用固定种子和短局参数快速走完八步：先看问题，再看规则怎么被装上，最后看图鉴如何总结。
          每一步都能直接跳过去，不需要先正式通关。
        </p>
        <div className="showcase-meta-row">
          <Chip tone="amber" icon="🎬">
            演示模式 · 固定种子演示
          </Chip>
          <Chip tone={doneCount > 0 ? 'green' : 'neutral'} icon="👣">
            演示步骤 {doneCount} / {SHOWCASE_TOTAL_STEPS}
          </Chip>
          <Button variant="secondary" size="sm" onClick={resetDemo}>
            重置演示
          </Button>
        </div>
      </header>

      <div className="showcase-demo-notice" role="note">
        <strong>演示不写入正式进度、不解锁图鉴，刷新页面会重置演示进度。</strong>
        <span>
          固定种子 {SHOWCASE_SEED} 与短局参数只用于重复演示，和正常模式的随机种子分开；这里出现的完成记录只存在当前页面内存里。
        </span>
      </div>

      <section className="showcase-progress" aria-label="演示进度">
        <Meter
          label="演示进度"
          value={doneCount}
          max={SHOWCASE_TOTAL_STEPS}
          tone="amber"
          valueLabel={`${doneCount} / ${SHOWCASE_TOTAL_STEPS}（${percent}%）`}
        />
        <div className="showcase-completed-levels">
          <span className="showcase-completed-label">演示中完成过的关卡</span>
          {demo.completedLevels.length === 0 ? (
            <span className="showcase-completed-empty">还没有。进入任一关完成演示后，这里会出现内存记录。</span>
          ) : (
            <ul className="showcase-chip-row">
              {demo.completedLevels.map((levelId) => {
                const level = getLevel(levelId);
                return (
                  <li key={levelId}>
                    <Chip tone="purple">{level.title}</Chip>
                  </li>
                );
              })}
            </ul>
          )}
          {demo.lastCompleted && (
            <span className="showcase-completed-empty">
              最近一次演示完成：{getLevel(demo.lastCompleted).title}（对应步骤会自动标记为已完成）
            </span>
          )}
        </div>
        <p className="showcase-progress-note">
          手动记录的步骤：{demo.completedSteps.length} / {SHOWCASE_TOTAL_STEPS}；若关卡返回了演示完成记录，对应步骤会自动计入上面的完成判断。
        </p>
        <p className="showcase-progress-note">
          本页只统计演示记录，不读取也不修改正式进度；正式进度可在「设置与存档」查看。
        </p>
      </section>

      <ol className="showcase-steps">
        {SHOWCASE_STEPS.map((step) => {
          const done = isShowcaseStepDone(step, demo);
          return (
            <li className={`showcase-step${done ? ' is-done' : ''}`} key={step.id}>
              <div className="showcase-step-head">
                <span className="showcase-step-no" aria-hidden="true">
                  {String(step.order).padStart(2, '0')}
                </span>
                <div className="showcase-step-heading">
                  <h2 className="showcase-step-title">{step.title}</h2>
                  <p className="showcase-step-desc">{step.description}</p>
                </div>
                {done ? (
                  <Chip tone="green" icon="✓">
                    已完成
                  </Chip>
                ) : (
                  <Chip tone="neutral">未完成</Chip>
                )}
              </div>

              <p className="showcase-step-cue">{step.cue}</p>

              {step.skipTransfer && (
                <p className="showcase-skip">
                  <strong>演示跳过迁移题</strong>
                  <span>这一步只演示到验证阶段，迁移题在演示中跳过，不计正式完成。</span>
                </p>
              )}

              <div className="showcase-step-actions">
                {step.kind === 'intro' && (
                  <Button size="sm" variant={done ? 'secondary' : 'primary'} onClick={() => markIntro(step)}>
                    {done ? '本步已标记完成' : '开始演示 · 标记本步'}
                  </Button>
                )}
                {step.kind === 'level' &&
                  step.targets.map((target) => (
                    <Button
                      key={target.levelId}
                      size="sm"
                      variant={done ? 'secondary' : 'primary'}
                      onClick={() => openLevel(step, target)}
                    >
                      开始本步 · {target.actionLabel}
                    </Button>
                  ))}
                {step.kind === 'codex' && (
                  <Button size="sm" variant={done ? 'secondary' : 'primary'} onClick={() => openCodex(step)}>
                    跳到本步 · 打开图鉴
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="showcase-footer">
        <p>
          固定种子只保证演示可以重复，不代表不同操作路径构成严格公平的实验；所有结论都来自当场真实操作，不生成假统计。
        </p>
        <div className="showcase-footer-actions">
          <Button variant="secondary" onClick={resetDemo}>
            重置演示
          </Button>
          <Button variant="secondary" onClick={handleBackHome}>
            返回修理铺
          </Button>
        </div>
      </footer>
    </div>
  );
}
