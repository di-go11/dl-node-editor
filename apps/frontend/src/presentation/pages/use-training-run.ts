import { useCallback } from 'react'
import { useNavigate } from 'react-router'

import type { RunState } from '../../application/run-state/run-state'
import {
  beginCheck,
  beginStart,
  canStart,
  checkTargetOf,
  effectiveRunState,
  finishCheck,
  finishStart,
  isStaleResult,
} from '../../application/run-state/run-state'
import { checkIntegrityWithServer } from '../../application/usecases/check-integrity'
import { startTraining } from '../../application/usecases/start-training'
import type { Issue } from '../../entity/validation/issue'
import { useDependencies } from '../app/dependencies'
import { useEditorStore, useEditorStoreApi } from '../stores/editor-store-context'

/**
 * [整合性チェック] と [学習実行] の操作。状態機械(application/run-state)の遷移と、
 * ユースケース(checkIntegrityWithServer / startTraining)の呼び出しをつなぐ。
 *
 * 状態の遷移の規則はすべて run-state.ts にあり、ここでは
 *   遷移関数で次の状態を計算する → ストアに入れる → ユースケースを待つ → 結果で次の状態を計算する
 * を繰り返すだけである。
 *
 * 非同期の結果が返ってきたときは、必ずその時点のストアの状態から次の状態を計算する
 * (store.getState())。待っている間に利用者が編集していれば、状態機械が結果を捨てる。
 */

export type TrainingRun = {
  /** 今の内容に照らした状態(チェックの後に変更していれば editing) */
  readonly state: RunState
  readonly canCheck: boolean
  readonly canStart: boolean
  /** ログに出す、チェックの結果 */
  readonly issues: readonly Issue[]
  /** 表示している結果が、その後の変更で古くなっているか */
  readonly stale: boolean
  readonly check: () => Promise<void>
  readonly start: () => Promise<void>
}

export function useTrainingRun(availableDevices: readonly string[] | undefined): TrainingRun {
  const store = useEditorStoreApi()
  const { trainingApi } = useDependencies()
  const navigate = useNavigate()
  const runState = useEditorStore((state) => state.runState)
  const document = useEditorStore((state) => state.document)

  const target = checkTargetOf(document)
  const state = effectiveRunState(runState, target)

  const check = useCallback(async () => {
    const before = store.getState()
    const checkTarget = checkTargetOf(before.document)
    if (checkTarget === null) return
    const checking = beginCheck(before.runState, checkTarget)
    // 学習を始めている最中・学習中はチェックしない(サーバーにも問い合わせない)
    if (checking.kind !== 'checking') return
    before.setRunState(checking)

    // サーバーの応答を待つ間に利用者が編集していれば、finishCheck が結果を捨てる
    const result = await checkIntegrityWithServer(
      { trainingApi },
      {
        graph: checkTarget.graph,
        context: checkTarget.context,
        catalog: before.catalog,
        settings: checkTarget.training,
        ...(availableDevices === undefined ? {} : { availableDevices }),
      },
    )
    const after = store.getState()
    after.setRunState(finishCheck(after.runState, checkTarget, result))
  }, [store, trainingApi, availableDevices])

  const start = useCallback(async () => {
    const before = store.getState()
    // ユースケースには「押した時点の状態(checked)」を渡す。starting に進めた後の状態を
    // 渡すと、ユースケースの確認(checked か)を通らない
    const checkedState = before.runState
    if (!canStart(checkedState, checkTargetOf(before.document))) return
    before.setRunState(beginStart(checkedState, checkTargetOf(before.document)))

    const result = await startTraining({ trainingApi }, checkedState, before.document)
    const after = store.getState()
    if (result.ok) {
      after.setRunState(finishStart(after.runState, { ok: true, jobId: result.jobId }))
      after.addMessages([{ level: 'info', text: `学習を開始しました(job_id: ${result.jobId})。` }])
      void navigate(`/progress/${encodeURIComponent(result.jobId)}`)
      return
    }
    after.setRunState(finishStart(after.runState, { ok: false }))
    if (result.reason === 'api') {
      after.addMessages([
        { level: 'error', text: `学習を開始できませんでした: ${result.error.message}` },
      ])
    }
  }, [store, trainingApi, navigate])

  const issues =
    state.kind === 'checked' || state.kind === 'starting'
      ? state.result.issues
      : state.kind === 'editing'
        ? (state.lastResult?.issues ?? [])
        : []

  return {
    state,
    canCheck: target !== null && (state.kind === 'editing' || state.kind === 'checked'),
    canStart: canStart(runState, target),
    issues,
    stale: isStaleResult(state, target),
    check,
    start,
  }
}
