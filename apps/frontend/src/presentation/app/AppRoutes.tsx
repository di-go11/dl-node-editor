import { Link, Route, Routes } from 'react-router'

import { useUnsavedChangesWarning } from '../components/header/use-document-actions'
import { EditorPage } from '../pages/EditorPage'
import { ProgressPage } from '../pages/ProgressPage'
import { ResumeListPage } from '../pages/ResumeListPage'
import { ResumeSettingsPage } from '../pages/ResumeSettingsPage'
import { TrainingSettingsPage } from '../pages/TrainingSettingsPage'

import { EditorSession } from './EditorSession'

/**
 * 画面の対応表(ルーティング)。指示書 4.1 の 3 画面。
 *
 *   /                  ノードエディタ画面(起動時に表示する)
 *   /training          学習設定画面(フェーズ 5)
 *   /progress/:jobId   進捗画面(フェーズ 6。URL に job_id を持つので、再読み込みしても同じ学習を見られる)
 *   /resume            学習再開の一覧(学習済みモデルを選ぶ。issue doc 作業 7)
 *   /resume/:modelId   学習再開の設定(前回の設定を初期値にし、変えられる項目だけを編集する)
 *
 * 画面ごとに URL を分けるのは、ブラウザの「戻る」で前の画面に戻れるようにするためである。
 */
export function AppRoutes() {
  return (
    <EditorSession>
      <UnsavedChangesGuard />
      <Routes>
        <Route path="/" element={<EditorPage />} />
        <Route path="/training" element={<TrainingSettingsPage />} />
        <Route path="/progress/:jobId" element={<ProgressPage />} />
        <Route path="/resume" element={<ResumeListPage />} />
        <Route path="/resume/:modelId" element={<ResumeSettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </EditorSession>
  )
}

/**
 * 保存していない変更があるときに、タブを閉じる前の警告を出す。
 * どの画面にいても効くよう、ルーティングの外(セッションの中)に置く。
 */
function UnsavedChangesGuard() {
  useUnsavedChangesWarning()
  return null
}

function NotFound() {
  return (
    <main>
      <h1>ページが見つかりません</h1>
      <Link to="/">エディタに戻る</Link>
    </main>
  )
}
