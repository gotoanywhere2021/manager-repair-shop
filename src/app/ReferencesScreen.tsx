import { useApp } from './AppContext';
import { Button, Panel } from '../components/Ui';

export function ReferencesScreen() {
  const { navigate } = useApp();
  return (
    <div className="page references-page">
      <button type="button" className="back-link" onClick={() => navigate({ kind: 'home' })}>
        <span aria-hidden="true">←</span> 返回修理铺
      </button>
      <header className="page-header">
        <p className="eyebrow">来源与边界</p>
        <h1 className="page-title">设计参考</h1>
        <p className="page-lead">
          这个修理铺参考了哪些公开资料，哪些内容是原创，哪些数字只是简化原型。
        </p>
      </header>

      <Panel title="非官方声明">
        <p className="tool-copy">
          本项目是一个独立、非官方的教学原型，与 Sports Interactive、Sega 或《Football Manager》系列没有隶属关系，
          也未获得作者、发行方或任何俱乐部的授权、推荐或背书。
        </p>
        <p className="tool-copy">
          系统的选题方向参考了《Football Manager 26》官方公开的功能介绍（双形态战术、比赛日、球探、转会、国际管理），
          参考地址：footballmanager.com/fm26/features 。本作没有复制其界面、图标、文本、数据库或规则表。
        </p>
      </Panel>

      <Panel title="原创部分" tone="green">
        <ul className="bullet-list">
          <li>四个关卡的规则、数值、俱乐部与人物角色、全部界面文案与视觉表现。</li>
          <li>经理图鉴四张卡的定义、体验、决策结构、适用情况、常见误用与联动建议。</li>
          <li>比赛、球探、转会与注册的简化模型，全部由 CSS 与简单图形绘制，不使用外部图片 CDN。</li>
          <li>随机数、事件日志、进度存储与测试代码。</li>
        </ul>
        <p className="tool-copy">
          游戏中的俱乐部、球员与教练均为虚构名称，不使用真实俱乐部、队徽、球员或教练姓名。
        </p>
      </Panel>

      <Panel title="参数说明" tone="amber">
        <p className="tool-copy">
          关卡里的比赛阶段、危险概率、知识度、转会预算、工资空间与注册名额都是可调的简化原型参数，
          用来让系统差异在几分钟内被看见，不代表《Football Manager 26》的实际规则、数据库或真实比赛结果。
        </p>
        <p className="tool-copy">所有对比数据只读取你自己的本地操作记录。</p>
      </Panel>

      <Panel title="教学效果说明" tone="purple">
        <p className="tool-copy">
          「30 秒进入第一关」「单关约 4 分钟」「展示模式约 5 分钟」是设计目标，不是经过真实用户研究验证的成果。
          游戏不自动判断「你已经学会」，只用三个维修证据检查项提示你是否真的体验、操作与迁移过。
        </p>
        <Button variant="secondary" onClick={() => navigate({ kind: 'home' })}>
          返回委托板
        </Button>
      </Panel>
    </div>
  );
}
