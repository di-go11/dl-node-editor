import './App.css'

/**
 * 仮置きの画面。フェーズ2でノードエディタ画面(presentation/pages/EditorPage)に置き換える。
 * ここではフェーズ0の完了条件(開発サーバーが開く、テストが走る)を確認するためだけに置いている。
 */
function App() {
  return (
    <main className="placeholder">
      <h1>深層学習モデルエディタ</h1>
      <p>フロントエンドの開発環境を構築しました。画面はフェーズ2から実装します。</p>
      <dl>
        <dt>モック API</dt>
        <dd>{import.meta.env.VITE_USE_MOCK === 'true' ? '有効 (MSW)' : '無効 (実 API)'}</dd>
      </dl>
    </main>
  )
}

export default App
