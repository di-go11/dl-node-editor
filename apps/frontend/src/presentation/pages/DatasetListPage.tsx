import { useState } from 'react'
import { Link } from 'react-router'

import type { DatasetSummary } from '../../entity/dataset/dataset'
import { ANNOTATION_TYPES } from '../../entity/training/data-spec'
import { DatasetUploadForm } from '../components/dataset/DatasetUploadForm'
import { useDatasets } from '../components/dataset/use-datasets'

import styles from './TrainedModelPage.module.css'

/**
 * データセット一覧画面(/datasets)。エディタのヘッダの [データセット] から開く。
 *
 *   [← エディタ]  データセット                                  [+ 追加]
 *   (追加のフォーム:zip・名前・形式)
 *   名前 | 形式 | 登録日時
 *
 * [+ 追加] で zip をアップロードして登録する。登録したデータセットは、学習設定画面の
 * データセットの選択肢に出る。サーバー上のパスはこの画面でも扱わない。
 */
export function DatasetListPage() {
  const datasets = useDatasets()
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const state = datasets.state

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>
          ← エディタ
        </Link>
        <h1 className={styles.title}>データセット</h1>
        <div className={styles.spacer} />
        <button
          type="button"
          className={styles.primary}
          disabled={adding}
          onClick={() => {
            setAdding(true)
            setNotice(null)
          }}
        >
          + 追加
        </button>
      </header>

      <main className={styles.main}>
        {adding && (
          <DatasetUploadForm
            onUploaded={(name) => {
              setAdding(false)
              setNotice(`「${name}」を追加しました。`)
              datasets.reload()
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        {notice !== null && (
          <p role="status" className={styles.muted}>
            {notice}
          </p>
        )}

        {state.status === 'loading' && <p role="status">データセットを読み込んでいます…</p>}
        {state.status === 'error' && (
          <p role="alert" className={styles.error}>
            データセットの一覧を取得できませんでした: {state.message}
          </p>
        )}
        {state.status === 'ready' && state.datasets.length === 0 && (
          <p className={styles.muted}>
            データセットはまだありません。[+ 追加] から zip
            をアップロードすると、ここに表示されます。
          </p>
        )}
        {state.status === 'ready' && state.datasets.length > 0 && (
          <DatasetTable datasets={state.datasets} />
        )}
      </main>
    </div>
  )
}

/** 形式の表示名。アノテーションの形式にない値(手で登録したものなど)はそのまま出す */
function typeLabel(type: string): string {
  return type in ANNOTATION_TYPES
    ? ANNOTATION_TYPES[type as keyof typeof ANNOTATION_TYPES].label
    : type
}

function DatasetTable({ datasets }: { readonly datasets: readonly DatasetSummary[] }) {
  return (
    <table className={styles.table} aria-label="データセット">
      <thead>
        <tr>
          <th scope="col">名前</th>
          <th scope="col">形式</th>
          <th scope="col">登録日時</th>
        </tr>
      </thead>
      <tbody>
        {datasets.map((dataset) => (
          <tr key={dataset.datasetId}>
            <td>{dataset.name}</td>
            <td>{typeLabel(dataset.type)}</td>
            <td>{formatDateTime(dataset.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** サーバーの日時(UTC の文字列)を、利用者の地域の時刻で表示する。読めない形ならそのまま出す */
function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
