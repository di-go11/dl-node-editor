import { Link, Route, Routes } from 'react-router'

import { EditorPage } from '../pages/EditorPage'
import { ProgressPage } from '../pages/ProgressPage'
import { TrainingSettingsPage } from '../pages/TrainingSettingsPage'

import { EditorSession } from './EditorSession'

/**
 * 画面の対応表(ルーティング)。指示書 4.1 の 3 画面。
 *
 *   /                  ノードエディタ画面(起動時に表示する)
 *   /training          学習設定画面(フェーズ 5)
 *   /progress/:jobId   進捗画面(フェーズ 6。URL に job_id を持つので、再読み込みしても同じ学習を見られる)
 *
 * 画面ごとに URL を分けるのは、ブラウザの「戻る」で前の画面に戻れるようにするためである。
 */
export function AppRoutes() {
  return (
    <EditorSession>
      <Routes>
        <Route path="/" element={<EditorPage />} />
        <Route path="/training" element={<TrainingSettingsPage />} />
        <Route path="/progress/:jobId" element={<ProgressPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </EditorSession>
  )
}

function NotFound() {
  return (
    <main>
      <h1>ページが見つかりません</h1>
      <Link to="/">エディタに戻る</Link>
    </main>
  )
}
