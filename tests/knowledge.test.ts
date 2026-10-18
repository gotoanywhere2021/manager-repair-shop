import { describe, expect, it } from 'vitest';
import { LEVELS, LEVEL_ORDER, MECHANISM_NAMES } from '../src/game/levels';
import {
  BOOK_REFERENCE,
  KNOWLEDGE_ANATOMY,
  KNOWLEDGE_CHECKLIST,
  KNOWLEDGE_FOUNDATIONS,
  KNOWLEDGE_FOR_LEVEL,
  KNOWLEDGE_FOR_MECHANISM,
  KNOWLEDGE_GLOSSARY,
  KNOWLEDGE_LEVEL_TOPICS,
} from '../src/content/mechanismKnowledge';

describe('机制原理馆内容', () => {
  it('四关都有对应的底层机制专题，且 id 唯一', () => {
    const ids = KNOWLEDGE_LEVEL_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(KNOWLEDGE_LEVEL_TOPICS).toHaveLength(4);
    for (const levelId of LEVEL_ORDER) {
      expect(KNOWLEDGE_FOR_LEVEL[levelId]).toBeTruthy();
      const topic = KNOWLEDGE_LEVEL_TOPICS.find((item) => item.levelId === levelId);
      expect(topic).toBeTruthy();
      expect(topic?.id).toBe(KNOWLEDGE_FOR_LEVEL[levelId]);
    }
  });

  it('每张关卡机制卡都有摘要、拆解、设计问题、误用与书目参考', () => {
    for (const topic of KNOWLEDGE_LEVEL_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(4);
      expect(topic.summary.length).toBeGreaterThan(40);
      expect(topic.sections.length).toBeGreaterThanOrEqual(3);
      for (const section of topic.sections) {
        expect(section.heading.length).toBeGreaterThan(2);
        expect(section.body.length).toBeGreaterThan(20);
      }
      expect(topic.designQuestions.length).toBeGreaterThanOrEqual(3);
      expect(topic.pitfalls.length).toBeGreaterThanOrEqual(2);
      expect(topic.bookRefs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('基础课覆盖行动、工人放置、信息、拍卖、经济、成套收集与组合', () => {
    const ids = KNOWLEDGE_FOUNDATIONS.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'foundation-actions',
        'foundation-worker',
        'foundation-information',
        'foundation-auction',
        'foundation-economy',
        'foundation-sets',
        'foundation-combination',
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const foundation of KNOWLEDGE_FOUNDATIONS) {
      expect(foundation.summary.length).toBeGreaterThan(20);
      expect(foundation.principle.length).toBeGreaterThan(20);
      expect(foundation.inThisGame.length).toBeGreaterThan(15);
      expect(foundation.bookRefs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('四个系统都映射到机制知识专题', () => {
    for (const level of LEVELS) {
      const topics = KNOWLEDGE_FOR_MECHANISM[level.mechanismId];
      expect(topics.length).toBeGreaterThanOrEqual(2);
      for (const topicId of topics) {
        const exists =
          KNOWLEDGE_LEVEL_TOPICS.some((topic) => topic.id === topicId) ||
          KNOWLEDGE_FOUNDATIONS.some((topic) => topic.id === topicId);
        expect(exists).toBe(true);
      }
      expect(MECHANISM_NAMES[level.mechanismId].zh.length).toBeGreaterThan(2);
    }
    expect(Object.keys(KNOWLEDGE_FOR_MECHANISM)).toHaveLength(4);
  });

  it('术语表、分析清单与机制解剖足够支撑阅读', () => {
    expect(KNOWLEDGE_GLOSSARY.length).toBeGreaterThanOrEqual(20);
    for (const entry of KNOWLEDGE_GLOSSARY) {
      expect(entry.term.length).toBeGreaterThan(1);
      expect(entry.definition.length).toBeGreaterThan(8);
      expect(entry.english.length).toBeGreaterThan(2);
    }
    expect(KNOWLEDGE_CHECKLIST.length).toBeGreaterThanOrEqual(6);
    expect(KNOWLEDGE_ANATOMY.length).toBeGreaterThanOrEqual(4);
    expect(KNOWLEDGE_ANATOMY.map((step) => step.step)).toEqual(['规则', '选择', '信息', '体验', '迁移']);
  });

  it('书目信息完整，且正文不使用页码引用', () => {
    expect(BOOK_REFERENCE.title).toContain('机制百科全书');
    expect(BOOK_REFERENCE.authors).toContain('Engelstein');
    expect(BOOK_REFERENCE.isbn).toMatch(/^978-/);
    const allText = [
      ...KNOWLEDGE_LEVEL_TOPICS.flatMap((topic) => [topic.summary, ...topic.sections.flatMap((section) => [section.body, ...(section.bullets ?? [])])]),
      ...KNOWLEDGE_FOUNDATIONS.flatMap((topic) => [topic.summary, topic.principle, topic.inThisGame]),
      ...KNOWLEDGE_GLOSSARY.flatMap((entry) => [entry.definition]),
    ].join('\n');
    expect(allText).not.toMatch(/第\s*\d+\s*页/);
    expect(allText).not.toContain('复制原书正文');
    expect(allText.length).toBeGreaterThan(3000);
  });
});
