import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import type { ApiError } from '../../application/ports/api-result'
import type { TrainedModelSummary } from '../../entity/trained-model/trained-model'
import { IMAGE_TASK_TYPES } from '../../entity/training/data-spec'
import { TRAINING_STATUS_LABELS } from '../../entity/training/progress'
import { useDependencies } from '../app/dependencies'

import styles from './TrainedModelPage.module.css'

/**
 * 学習済みモデルの一覧画面(/models。issue doc 作業 7)。
 *
 *   [← エディタ]  モデル一覧
 *   名前 | タスク | 最終学習日時 | 状態 | 完了エポック数 | [パラメータ一覧&学習再開]
 *
 * 学習済みのモデルを一覧にし、選ぶと詳細画面(/models/:modelId)に移る。
 * エディタの文書(グラフや学習設定)は使わない。再開するモデルの構造はサーバーが持っている。
 */

type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly models: readonly TrainedModelSummary[] }
  | { readonly status: 'error'; readonly error: ApiError }

export function TrainedModelListPage() {
  const { trainedModelApi } = useDependencies()
  const [state, setState] = useState<ListState>({ status: 'loading' })

  useEffect(() => {
    // 取得の途中で画面が外れたら、結果を捨てる(外れた部品の state を書き換えないため)
    let cancelled = false
    void trainedModelApi.list().then((result) => {
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', models: result.value }
          : { status: 'error', error: result.error },
      )
    })
    return () => {
      cancelled = true
    }
  }, [trainedModelApi])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          ← エディタ
        </Link>
        <h1 className={styles.title}>モデル一覧</h1>
      </header>

      <main className={styles.main}>
        {state.status === 'loading' && <p role="status">学習済みモデルを読み込んでいます…</p>}
        {state.status === 'error' && (
          <p role="alert" className={styles.error}>
            学習済みモデルの一覧を取得できませんでした: {state.error.message}
          </p>
        )}
        {state.status === 'ready' && state.models.length === 0 && (
          <p className={styles.muted}>
            学習済みのモデルはまだありません。エディタの [学習開始]
            から学習すると、ここに表示されます。
          </p>
        )}
        {state.status === 'ready' && state.models.length > 0 && (
          <ModelTable models={state.models} />
        )}
      </main>
    </div>
  )
}

function ModelTable({ models }: { readonly models: readonly TrainedModelSummary[] }) {
  return (
    <table className={styles.table} aria-label="学習済みモデル">
      <thead>
        <tr>
          <th scope="col">モデル名</th>
          <th scope="col">タスク</th>
          <th scope="col">最終学習日時</th>
          <th scope="col">状態</th>
          <th scope="col" className={styles.number}>
            完了エポック数
          </th>
          <th scope="col">
            <span className={styles.muted}>操作</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => (
          <tr key={model.modelId}>
            <td>{model.modelName}</td>
            <td>{IMAGE_TASK_TYPES[model.task].label}</td>
            <td>{formatDateTime(model.lastRun.startedAt)}</td>
            <td>
              {TRAINING_STATUS_LABELS[model.lastRun.status]}
              {model.lastRun.failureReason !== null && (
                <span className={styles.reason}>{model.lastRun.failureReason}</span>
              )}
            </td>
            <td className={styles.number}>{model.completedEpochs}</td>
            <td>
              {model.resumable ? (
                <Link to={`/models/${encodeURIComponent(model.modelId)}`}>
                  パラメータ一覧&学習再開
                </Link>
              ) : (
                <span className={styles.muted} title="モデル構造が保存されていない古いモデルです">
                  再開できません
                </span>
              )}
              {' / '}
              {/* 学習の記録(グラフと表)は、再開できない古いモデルでも見られる */}
              <Link to={`/models/${encodeURIComponent(model.modelId)}/history`}>学習の記録</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * サーバーの日時(UTC の文字列)を、利用者の地域の時刻で表示する。
 * 読めない形ならそのまま出す(表示のためだけなので、失敗にはしない)
 */
function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
