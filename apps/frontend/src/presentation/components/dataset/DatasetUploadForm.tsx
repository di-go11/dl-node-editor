import { useId, useState } from 'react'

import { datasetNameFromFileName, isZipFileName } from '../../../entity/dataset/dataset'
import { ANNOTATION_TYPES } from '../../../entity/training/data-spec'
import type { AnnotationKind } from '../../../entity/training/data-spec'
import { useDependencies } from '../../app/dependencies'

import styles from './DatasetUploadForm.module.css'

/**
 * データセットの追加(zip のアップロード)のフォーム。データセット一覧画面の [+ 追加] で開く。
 *
 *   zip ファイル [選択]   名前 [voc2012]   形式 [Pascal VOC ▼]   [アップロード] [キャンセル]
 *
 * 名前の初期値は zip のファイル名から作る。形式の選択肢は、学習設定のアノテーションの形式と同じもの
 * (学習設定で選ぶ形式とデータセットの形式をそろえるため)。
 *
 * サーバーは zip を受け取りきって解凍・登録を終えてから応答するので、大きい zip は時間がかかる。
 * その間はフォームを無効にし、送っている最中であることを表示する。
 */

export type DatasetUploadFormProps = {
  /** アップロードが成功した(登録した名前を渡す) */
  readonly onUploaded: (name: string) => void
  readonly onCancel: () => void
}

type UploadState =
  | { readonly status: 'editing' }
  | { readonly status: 'uploading' }
  | { readonly status: 'error'; readonly message: string }

const ANNOTATION_KINDS = Object.keys(ANNOTATION_TYPES) as AnnotationKind[]

/**
 * 形式ごとに zip に必要なもの(契約の POST /datasets/upload の type の説明と同じ)。
 * サーバーは解凍後にこれを確かめ、足りなければ 422 で足りないものを返す
 */
const VOC_LAYOUT = 'JPEGImages/、SegmentationClass/、ImageSets/Segmentation/train.txt・val.txt'
const REQUIRED_LAYOUT_HINT: Record<AnnotationKind, string> = {
  pascal_voc: `必要なもの: ${VOC_LAYOUT}`,
  original: `必要なもの: ${VOC_LAYOUT}、labelmap.txt`,
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${Math.ceil(bytes / 1024)} KiB`
}

export function DatasetUploadForm({ onUploaded, onCancel }: DatasetUploadFormProps) {
  const { datasetApi } = useDependencies()
  const fileId = useId()
  const nameId = useId()
  const typeId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<AnnotationKind>(ANNOTATION_KINDS[0] ?? 'pascal_voc')
  const [state, setState] = useState<UploadState>({ status: 'editing' })

  const uploading = state.status === 'uploading'
  const notZip = file !== null && !isZipFileName(file.name)
  const canUpload = file !== null && !notZip && name.trim() !== '' && !uploading

  const upload = async () => {
    if (file === null || !canUpload) return
    setState({ status: 'uploading' })
    const result = await datasetApi.upload({
      file,
      fileName: file.name,
      name: name.trim(),
      type,
    })
    if (result.ok) {
      onUploaded(name.trim())
    } else {
      setState({ status: 'error', message: result.error.message })
    }
  }

  return (
    <form
      className={styles.form}
      aria-label="データセットの追加"
      onSubmit={(event) => {
        event.preventDefault()
        void upload()
      }}
    >
      <fieldset className={styles.fieldset} disabled={uploading}>
        <legend className={styles.legend}>データセットの追加</legend>

        <div className={styles.field}>
          <label htmlFor={fileId} className={styles.label}>
            zip ファイル
          </label>
          <input
            id={fileId}
            type="file"
            accept=".zip,application/zip"
            aria-invalid={notZip}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null
              setFile(selected)
              // 名前を入れる前にファイルを選んだら、ファイル名を名前の初期値にする
              if (selected !== null && name.trim() === '') {
                setName(datasetNameFromFileName(selected.name))
              }
            }}
          />
          {file !== null && !notZip && <p className={styles.hint}>{formatSize(file.size)}</p>}
          {notZip && <p className={styles.error}>zip ファイルを選んでください。</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>
            名前
          </label>
          <input
            id={nameId}
            className={styles.input}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={typeId} className={styles.label}>
            形式
          </label>
          <select
            id={typeId}
            className={styles.input}
            value={type}
            onChange={(event) => setType(event.target.value as AnnotationKind)}
          >
            {ANNOTATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {ANNOTATION_TYPES[kind].label}
              </option>
            ))}
          </select>
          <p className={styles.hint}>{ANNOTATION_TYPES[type].description}</p>
          <p className={styles.hint}>{REQUIRED_LAYOUT_HINT[type]}</p>
        </div>

        <p className={styles.hint}>
          zip の直下がフォルダ 1 つだけなら、その中身がデータセットになります。
        </p>

        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!canUpload}>
            アップロード
          </button>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </fieldset>

      {uploading && (
        <p role="status" className={styles.hint}>
          アップロードしています…(サーバーで解凍・登録が終わるまで待ちます。大きい zip
          は時間がかかります)
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className={styles.error}>
          アップロードできませんでした: {state.message}
        </p>
      )}
    </form>
  )
}
