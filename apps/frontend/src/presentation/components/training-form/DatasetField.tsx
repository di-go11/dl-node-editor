import { useId } from 'react'

import type { DatasetSummary } from '../../../entity/dataset/dataset'

import styles from './TrainingForm.module.css'
import type { DatasetsState } from '../dataset/use-datasets'

/**
 * データセットの選択欄(新規学習でだけ出す)。登録済みデータセットの一覧から 1 つ選ぶ。
 *
 * 選んだデータセットの ID を学習設定に入れる。サーバー上のパスは扱わない
 * (学習開始のときに、サーバーが ID からパスを決める)。
 *
 * プルダウンにしているのは、フォームの他の項目(device など)と並びを揃えるためである。
 * 選択肢には名前に加えて形式と登録日を添え、同じ名前のデータセットも見分けられるようにする。
 */

export type DatasetFieldProps = {
  /** 選んでいるデータセットの ID。空文字は未選択 */
  readonly value: string
  readonly onChange: (datasetId: string) => void
  readonly datasets: DatasetsState
  readonly onReload: () => void
  /** 検証の結果(未選択など) */
  readonly messages: readonly string[]
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function optionLabel(dataset: DatasetSummary): string {
  return `${dataset.name}(${dataset.type}・${formatDate(dataset.createdAt)})`
}

export function DatasetField({ value, onChange, datasets, onReload, messages }: DatasetFieldProps) {
  const id = useId()
  const ready = datasets.status === 'ready'
  const list = ready ? datasets.datasets : []
  // 保存ファイルで選んでいたデータセットが、その後削除された(一覧にない)
  const missing = ready && value !== '' && !list.some((dataset) => dataset.datasetId === value)
  const noDatasets = ready && list.length === 0

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        データセット
        <span className={styles.name}>dataset_id</span>
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={!ready || noDatasets}
        aria-invalid={messages.length > 0 || missing}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {datasets.status === 'loading' ? '(読み込み中…)' : '(選んでください)'}
        </option>
        {list.map((dataset) => (
          <option key={dataset.datasetId} value={dataset.datasetId}>
            {optionLabel(dataset)}
          </option>
        ))}
        {/* 一覧にない ID も選択肢に残し、何が選ばれているかを見えるようにする */}
        {missing && <option value={value}>(一覧にないデータセット: {value})</option>}
      </select>
      {datasets.status === 'error' && (
        <p className={styles.error}>
          データセットの一覧を取得できませんでした: {datasets.message}{' '}
          <button type="button" onClick={onReload}>
            再読み込み
          </button>
        </p>
      )}
      {noDatasets && (
        <p className={styles.hint}>
          データセットがありません。先にデータセットをアップロードしてください。{' '}
          <button type="button" onClick={onReload}>
            再読み込み
          </button>
        </p>
      )}
      {missing && (
        <p className={styles.error}>
          選んでいたデータセットが一覧にありません(削除された可能性があります)。選び直してください。
        </p>
      )}
      {messages.map((message) => (
        <p key={message} className={styles.error}>
          {message}
        </p>
      ))}
    </div>
  )
}
