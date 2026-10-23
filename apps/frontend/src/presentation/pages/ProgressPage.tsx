import { Link, useParams } from 'react-router'

/** 進捗画面(指示書 4.6)。フェーズ 6 で作る。今は遷移の確認のための仮置き */
export function ProgressPage() {
  const { jobId } = useParams()
  return (
    <main>
      <h1>進捗</h1>
      <p>この画面はフェーズ 6 で実装します(job_id: {jobId})。</p>
      <Link to="/">エディタに戻る</Link>
    </main>
  )
}
