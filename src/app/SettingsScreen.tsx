import { useState } from 'react';
import { useApp } from './AppContext';
import { Button, ConfirmDialog, Panel, RuleList, Toggle } from '../components/Ui';
import { isStorageAvailable, PROGRESS_SCHEMA_VERSION } from '../storage/persistence';

export function SettingsScreen() {
  const { navigate, settings, setReduceMotion, resetProgress, progress } = useApp();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const storageAvailable = isStorageAvailable();

  return (
    <div className="page settings-page">
      <button type="button" className="back-link" onClick={() => navigate({ kind: 'home' })}>
        <span aria-hidden="true">←</span> 返回修理铺
      </button>
      <header className="page-header">
        <p className="eyebrow">修理铺后台</p>
        <h1 className="page-title">设置与存档</h1>
        <p className="page-lead">改显示偏好、查看本地存档、或把整个修理铺恢复成初始状态。</p>
      </header>

      <Panel title="显示与动效" subtitle="动画只用来辅助理解，不会阻塞操作。">
        <Toggle
          checked={settings.reduceMotion}
          onChange={setReduceMotion}
          label="减少动态效果"
          description="关闭收益飞入、工人落位等位移动画，只保留颜色与文字变化。你的系统「减少动态效果」设置也会被尊重。"
        />
      </Panel>

      <Panel title="本地存档" subtitle="进度、图鉴解锁和关卡状态都保存在这台设备的浏览器里。">
        <RuleList
          items={[
            { label: '存储状态', value: storageAvailable ? '可用（localStorage）' : '不可用，本次进度只保留在当前页面' },
            { label: '存档版本', value: `schema v${PROGRESS_SCHEMA_VERSION}` },
            { label: '已完成委托', value: `${progress.completedLevels.length} / 4` },
            { label: '已解锁图鉴', value: `${progress.unlockedMechanisms.length} / 4` },
            { label: '最近保存', value: formatTime(progress.lastSavedAt) },
          ]}
        />
        <div className="settings-danger">
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            重置全部进度
          </Button>
          <p className="settings-hint">会删除四关进度、图鉴解锁、关卡存档和显示设置。展示模式本来就不写正式进度。</p>
        </div>
      </Panel>

      <Panel title="设计参考" subtitle="系统选题参考公开介绍，规则、数值与案例均为原创简化模型。">
        <p className="tool-copy">《Building Blocks of Tabletop Game Design》，作者 Geoffrey Engelstein 与 Isaac Shalev。</p>
        <Button variant="secondary" onClick={() => navigate({ kind: 'references' })}>
          查看设计参考页
        </Button>
      </Panel>

      <ConfirmDialog
        open={confirmOpen}
        title="确定重置全部进度？"
        description={
          <>
            <p>四关的完成记录、图鉴解锁、进行中的关卡和显示设置都会被清除。</p>
            <p>这个动作不能撤销，重置后从第一关重新开始。</p>
          </>
        }
        confirmLabel="确认重置"
        cancelLabel="保留进度"
        tone="danger"
        onConfirm={() => {
          setConfirmOpen(false);
          resetProgress();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function formatTime(iso: string): string {
  if (!iso || iso === new Date(0).toISOString()) return '还没有保存过';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '还没有保存过';
  return date.toLocaleString('zh-CN', { hour12: false });
}
