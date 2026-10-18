import { useApp } from './AppContext';
import { HomeScreen } from './HomeScreen';
import { SettingsScreen } from './SettingsScreen';
import { CodexScreen } from './CodexScreen';
import { ShowcaseScreen } from './ShowcaseScreen';
import { ReferencesScreen } from './ReferencesScreen';
import { LevelPage } from './LevelPage';
import { Button } from '../components/Ui';
import type { Route } from './AppContext';

export function AppShell() {
  const { route, storageWarning, dismissWarning, toast, dismissToast } = useApp();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      {storageWarning && (
        <div className="storage-warning" role="alert">
          <span className="storage-warning-icon" aria-hidden="true">⚠</span>
          <span>{storageWarning}</span>
          <Button variant="ghost" size="sm" onClick={dismissWarning} aria-label="关闭存档提示">
            知道了
          </Button>
        </div>
      )}
      <div id="main-content" className="app-main">
        {renderRoute(route)}
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button type="button" className="toast-close" onClick={dismissToast} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function renderRoute(route: Route) {
  switch (route.kind) {
    case 'home':
      return <HomeScreen />;
    case 'level':
      return <LevelPage levelId={route.levelId} />;
    case 'codex':
      return <CodexScreen />;
    case 'showcase':
      return <ShowcaseScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'references':
      return <ReferencesScreen />;
  }
}
