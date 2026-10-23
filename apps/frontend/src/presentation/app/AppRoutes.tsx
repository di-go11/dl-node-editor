import { Link, Route, Routes } from 'react-router'

import { useEditorStore } from '../stores/editor-store-context'

import { EditorSession } from './EditorSession'

/**
 * 画面の対応表(ルーティング)。指示書 4.1 の 3 画面。
 *
 *   /                  ノードエディタ画面(起動時に表示する)
 *   /training          学習設定画面
 *   /progress/:jobId   進捗画面(URL に job_id を持つので、再読み込みしても同じ学習を見られる)
 *
 * 画面ごとに URL を分けるのは、ブラウザの「戻る」で前の画面に戻れるようにするためである。
 *
 * 各画面はまだ仮置き。エディタ画面は 2b、学習設定はフェーズ 5、進捗はフェーズ 6 で作る。
 */
export function AppRoutes() {
  return (
    <EditorSession>
      <Routes>
        <Route path="/" element={<EditorPlaceholder />} />
        <Route path="/training" element={<Placeholder title="学習設定" phase="フェーズ 5" />} />
        <Route path="/progress/:jobId" element={<Placeholder title="進捗" phase="フェーズ 6" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </EditorSession>
  )
}

/** 2b で EditorPage に置き換える。ストアがつながっていることだけを示す */
function EditorPlaceholder() {
  const nodeCount = useEditorStore((state) => state.document.graph.nodes.length)
  return (
    <main>
      <h1>ノードエディタ</h1>
      <p>画面は 2b で実装します(ノード数: {nodeCount})。</p>
    </main>
  )
}

function Placeholder({ title, phase }: { readonly title: string; readonly phase: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <p>この画面は{phase}で実装します。</p>
      <Link to="/">エディタに戻る</Link>
    </main>
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
