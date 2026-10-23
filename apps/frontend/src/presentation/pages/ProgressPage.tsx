import { useNavigate, useParams } from 'react-router'

import { finishRun } from '../../application/run-state/run-state'
import { useEditorStore, useEditorStoreApi } from '../stores/editor-store-context'

/**
 * 進捗画面(指示書 4.6)。フェーズ 6 で作る。今は遷移の確認のための仮置き。
 *
 * フェーズ 6 では、学習が終わったら(COMPLETED / FAILED / STOPPED)状態機械を
 * running から editing に戻す。それまでの間は、下のボタンで手で戻せるようにしておく
 * (戻せないと、学習設定画面で再チェックできなくなるため)。
 */
export function ProgressPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const store = useEditorStoreApi()
  const runState = useEditorStore((state) => state.runState)

  return (
    <main>
      <h1>進捗</h1>
      <p>この画面はフェーズ 6 で実装します(job_id: {jobId})。</p>
      {runState.kind === 'running' && <p>状態: 学習中(job_id: {runState.jobId})</p>}
      <button
        type="button"
        onClick={() => {
          const state = store.getState()
          state.setRunState(finishRun(state.runState))
          void navigate('/')
        }}
      >
        エディタに戻る(仮:学習の終了として扱う)
      </button>
    </main>
  )
}
