import { useEffect } from 'react';
import { useApp } from './AppContext';
import { LEVELS, MECHANISM_NAMES } from '../game/levels';
import {
  BOOK_REFERENCE,
  KNOWLEDGE_ANATOMY,
  KNOWLEDGE_CHECKLIST,
  KNOWLEDGE_FOUNDATIONS,
  KNOWLEDGE_GLOSSARY,
  KNOWLEDGE_LEVEL_TOPICS,
  type KnowledgeBookRef,
} from '../content/mechanismKnowledge';
import { Button, Callout, Chip, Panel } from '../components/Ui';
import '../content/knowledge.css';

function BookRefChips({ refs }: { refs: KnowledgeBookRef[] }) {
  return (
    <div className="knowledge-refs" aria-label="书目参考">
      <span className="knowledge-refs-label">书目中的相关机制</span>
      {refs.map((ref) => (
        <span className="knowledge-ref-chip" key={`${ref.code ?? ref.name}-${ref.name}`}>
          {ref.code && <strong>{ref.code}</strong>}
          {ref.name}
          <span className="knowledge-ref-chapter">{ref.chapter}</span>
        </span>
      ))}
    </div>
  );
}

export function KnowledgeScreen({ topicId }: { topicId?: string }) {
  const { navigate, startLevel, progress } = useApp();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!topicId) {
      if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const timer = window.setTimeout(() => {
      const element = document.getElementById(topicId);
      if (!element) return;
      element.classList.add('is-highlighted');
      const top = element.getBoundingClientRect().top + window.scrollY - 84;
      if (typeof window.scrollTo === 'function') window.scrollTo({ top, behavior: 'auto' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [topicId]);

  return (
    <div className="page knowledge-page">
      <button type="button" className="back-link" onClick={() => navigate({ kind: 'home' })}>
        <span aria-hidden="true">←</span> 返回修理铺
      </button>

      <header className="page-header knowledge-hero">
        <p className="eyebrow">机制原理馆 · 从“修好”到“看懂”</p>
        <h1 className="page-title">
          游戏规则背后的<span className="knowledge-title-accent">底层知识</span>
        </h1>
        <p className="page-lead">
          每一关修的不只是一条数值，而是一个桌游机制的结构：谁在做什么决定、信息如何流动、代价从哪里来。
          这里用四个关卡当例子，把「规则 → 选择 → 体验」拆开讲清楚。
        </p>
        <div className="knowledge-meta">
          <Chip tone="purple">四关对应四类机制</Chip>
          <Chip tone="green">机制解剖 + 术语表 + 分析清单</Chip>
          <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'codex' })}>
            打开经理图鉴
          </Button>
        </div>
      </header>

      <section className="knowledge-flow" aria-label="分析框架">
        {KNOWLEDGE_ANATOMY.map((step, index) => (
          <div className="knowledge-flow-step" key={step.step}>
            <span className="knowledge-flow-index">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <p className="knowledge-flow-title">
                {step.step} · {step.title}
              </p>
              <p className="knowledge-flow-body">{step.body}</p>
            </div>
          </div>
        ))}
      </section>

      <Callout tone="amber" title="先玩，再读">
        这些概念不是要你先背下来再玩。建议先完成一关，再回来对照：刚才那个“不划算”的选择，
        到底是哪条规则让它不划算？你也可以在任何关卡顶栏点「机制原理」，直接跳到对应的底层知识。
      </Callout>

      <section className="knowledge-section">
        <header className="knowledge-section-head">
          <div>
            <h2 className="section-title">四关的底层机制</h2>
            <p className="section-subtitle">从战术板到赛季名单，每一关都是一个可单独拆解的机制结构。</p>
          </div>
          <Chip tone="neutral">点击关卡标题可跳转对应委托</Chip>
        </header>

        <div className="knowledge-level-grid">
          {KNOWLEDGE_LEVEL_TOPICS.map((topic) => {
            const level = LEVELS.find((item) => item.id === topic.levelId);
            const mechanism = level ? MECHANISM_NAMES[level.mechanismId] : null;
            return (
              <article
                className={`knowledge-level-card${topicId === topic.id ? ' is-highlighted' : ''}`}
                id={topic.id}
                key={topic.id}
              >
                <header className="knowledge-level-head">
                  <span className="knowledge-level-order">
                    {level ? `关卡 ${String(level.order).padStart(2, '0')}` : '机制'}
                  </span>
                  <div>
                    <h3 className="knowledge-level-title">{topic.title}</h3>
                    <p className="knowledge-level-en">{topic.english}</p>
                  </div>
                  {mechanism && <Chip tone="purple">{mechanism.zh}</Chip>}
                </header>
                <p className="knowledge-level-tagline">“{topic.tagline}”</p>
                <p className="knowledge-level-summary">{topic.summary}</p>

                <div className="knowledge-level-sections">
                  {topic.sections.map((section) => (
                    <section className="knowledge-sub" key={section.heading}>
                      <h4>{section.heading}</h4>
                      <p>{section.body}</p>
                      {section.bullets && (
                        <ul>
                          {section.bullets.map((bullet) => (
                            <li key={bullet}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>

                <div className="knowledge-question-grid">
                  <div>
                    <h4 className="knowledge-mini-title">设计时该问的问题</h4>
                    <ul className="knowledge-question-list">
                      {topic.designQuestions.map((question) => (
                        <li key={question}>{question}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="knowledge-mini-title">常见误用</h4>
                    <ul className="knowledge-pitfall-list">
                      {topic.pitfalls.map((pitfall) => (
                        <li key={pitfall}>{pitfall}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <BookRefChips refs={topic.bookRefs} />

                <div className="knowledge-level-actions">
                  {level && level.id !== 'squad' && (
                    <Chip tone={progress.completedLevels.includes(level.id) ? 'green' : 'neutral'}>
                      {progress.completedLevels.includes(level.id) ? '已完成委托' : '对应委托'}
                    </Chip>
                  )}
                  {level && (
                    <Button size="sm" variant="secondary" onClick={() => startLevel(level.id)}>
                      去这一关验证
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => navigate({ kind: 'codex' })}>
                    对照图鉴卡
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="knowledge-section">
        <header className="knowledge-section-head">
          <div>
            <h2 className="section-title">机制基础课</h2>
            <p className="section-subtitle">
              十个可以迁移到其他游戏的设计概念：不按游戏分类，而按“它改变玩家什么行为”来分类。
            </p>
          </div>
          <Chip tone="neutral">展开阅读</Chip>
        </header>
        <div className="knowledge-foundation-grid">
          {KNOWLEDGE_FOUNDATIONS.map((foundation) => (
            <details className="knowledge-foundation" id={foundation.id} key={foundation.id}>
              <summary>
                <span className="knowledge-foundation-title">{foundation.title}</span>
                <span className="knowledge-foundation-en">{foundation.english}</span>
              </summary>
              <div className="knowledge-foundation-body">
                <p>{foundation.summary}</p>
                <p>
                  <strong>原理：</strong>
                  {foundation.principle}
                </p>
                <p>
                  <strong>在本作里：</strong>
                  {foundation.inThisGame}
                </p>
                <BookRefChips refs={foundation.bookRefs} />
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="knowledge-section">
        <header className="knowledge-section-head">
          <div>
            <h2 className="section-title">机制解剖：以战术板为例</h2>
            <p className="section-subtitle">不是“这套阵型强不强”，而是“它是怎样把规则变成体验的”。</p>
          </div>
        </header>
        <div className="knowledge-anatomy">
          {KNOWLEDGE_ANATOMY.map((step) => (
            <div className="knowledge-anatomy-step" key={step.step}>
              <span className="knowledge-anatomy-step-label">{step.step}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-two-col">
          <Panel title="分析任何游戏时，可以问自己" subtitle="这八个问题不是评分表，而是拆解工具。">
            <ol className="knowledge-checklist">
              {KNOWLEDGE_CHECKLIST.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </Panel>
          <Panel title="术语表" subtitle="在这里只给一句话定义，细节回到上方机制卡。" tone="purple">
            <dl className="knowledge-glossary">
              {KNOWLEDGE_GLOSSARY.map((entry) => (
                <div className="knowledge-glossary-row" key={entry.term}>
                  <dt>
                    {entry.term}
                    <span>{entry.english}</span>
                  </dt>
                  <dd>{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </section>

      <Panel title="书目与使用说明" tone="amber">
        <p className="knowledge-book-title">《{BOOK_REFERENCE.title}》</p>
        <p className="knowledge-book-meta">
          {BOOK_REFERENCE.originalTitle} · {BOOK_REFERENCE.authors} · {BOOK_REFERENCE.chineseEdition} · ISBN{' '}
          {BOOK_REFERENCE.isbn}
        </p>
        <p className="knowledge-book-note">{BOOK_REFERENCE.methodNote}</p>
        <p className="knowledge-book-note">{BOOK_REFERENCE.copyrightNote}</p>
        <div className="knowledge-book-actions">
          <Button variant="secondary" onClick={() => navigate({ kind: 'references' })}>
            查看设计参考与声明
          </Button>
          <Button variant="ghost" onClick={() => navigate({ kind: 'home' })}>
            返回委托板
          </Button>
        </div>
      </Panel>
    </div>
  );
}
