import { useCallback, useEffect, useState } from 'react'

import type { ProgressProblem } from '../../application/ports/training-api'
import { finishRun } from '../../application/run-state/run-state'
import type { LossPoint, TrainingProgress } from '../../entity/training/progress'
import { appendLossPoint, isTerminalStatus } from '../../entity/training/progress'
import { useDependencies } from '../app/dependencies'
import { useEditorStoreApi } from '../stores/editor-store-context'

/**
 * 進捗画面の状態。学習の進捗の受信と、停止の要求をつなぐ(指示書 4.6)。
 *
 * 受信の開始と終了は useEffect に置く。画面を離れると(job_id が変わっても)受信を閉じるので、
 * 見ていない学習の接続が残らない。
 *
 * 学習が終わったら、状態機械を running から editing に戻す(再チェックできるようにする)。
 */

export type TrainingProgressView = {
  /** 最後に受け取った進捗(まだ何も届いていなければ null) */
  readonly latest: TrainingProgress | null
  readonly lossPoints: readonly LossPoint[]
  readonly problem: ProgressProblem | null
  /** 学習が終わったか、もう進捗が届かない。これ以上の変化を待たなくてよい */
  readonly ended: boolean
  /** 停止を要求して、まだ止まっていない */
  readonly stopping: boolean
  readonly stopError: string | null
  readonly stop: () => Promise<void>
}

export function useTrainingProgress(jobId: string): TrainingProgressView {
  const { trainingApi } = useDependencies()
  const store = useEditorStoreApi()
  const [latest, setLatest] = useState<TrainingProgress | null>(null)
  const [lossPoints, setLossPoints] = useState<readonly LossPoint[]>([])
  const [problem, setProblem] = useState<ProgressProblem | null>(null)
  const [stopRequested, setStopRequested] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)

  useEffect(
    () =>
      trainingApi.subscribeProgress(jobId, {
        onProgress: (progress) => {
          setLatest(progress)
          setLossPoints((points) => appendLossPoint(points, progress))
          setProblem(null)
          if (isTerminalStatus(progress.status)) {
            const state = store.getState()
            state.setRunState(finishRun(state.runState))
          }
        },
        onProblem: setProblem,
      }),
    [trainingApi, store, jobId],
  )

  const stop = useCallback(async () => {
    setStopRequested(true)
    setStopError(null)
    const result = await trainingApi.stop(jobId)
    if (!result.ok) {
      setStopRequested(false)
      setStopError(result.error.message)
    }
  }, [trainingApi, jobId])

  const finished = latest !== null && isTerminalStatus(latest.status)

  return {
    latest,
    lossPoints,
    problem,
    ended: finished || problem?.retrying === false,
    stopping: stopRequested && !finished,
    stopError,
    stop,
  }
}
