import { useEffect } from 'react'
import { useNavigate } from 'react-router'

import type {
  ContextOption,
  DataDim,
  FeatureMethod,
} from '../../../entity/editor-context/editor-context'
import {
  DATA_DIM_OPTIONS,
  FEATURE_METHOD_OPTIONS,
} from '../../../entity/editor-context/editor-context'
import { useEditorStore } from '../../stores/editor-store-context'

import { DeviceStatus } from './DeviceStatus'
import styles from './Header.module.css'
import { useDocumentActions } from './use-document-actions'

/**
 * エディタ画面のヘッダ(指示書 4.2)。
 *
 *   [データ形式 ▼][特徴抽出手法 ▼]  [保存][読込]  デバイス: CUDA ✓ (cuda:0)  [学習再開][学習開始]
 *
 * 選択肢はエンティティ層の DATA_DIM_OPTIONS / FEATURE_METHOD_OPTIONS から作る。
 * 1D と Transformer は「近日実装予定」だが、選べるようにしておく(指示書 4.3)。
 * 選んだときの扱い(サイドバーの注意書き、置いたノードの赤色表示)はデータ側で決まる。
 *
 * [保存] / [読込] の中身は use-document-actions.ts。Ctrl+S(macOS では ⌘S)でも保存できる。
 * 保存していない変更があれば、文書の名前の横に「未保存」の印を出す。
 */

function optionLabel<T extends string>(option: ContextOption<T>): string {
  return option.available ? option.label : `${option.label}(近日実装予定)`
}

/** <select> の value(ただの文字列)を、選択肢の中の値として読む */
function findOption<T extends string>(
  options: readonly ContextOption<T>[],
  value: string,
): T | undefined {
  return options.find((option) => option.value === value)?.value
}

export function Header() {
  const context = useEditorStore((state) => state.document.context)
  const setContext = useEditorStore((state) => state.setContext)
  const name = useEditorStore((state) => state.document.meta.name)
  const navigate = useNavigate()
  const { save, open, isDirty } = useDocumentActions()

  // Ctrl+S で保存する。preventDefault しないと、ブラウザの「ページを保存」が開いてしまう
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <header className={styles.header}>
      <label className={styles.field}>
        データ形式
        <select
          value={context.dataDim}
          onChange={(event) => {
            const dataDim = findOption<DataDim>(DATA_DIM_OPTIONS, event.target.value)
            if (dataDim !== undefined) setContext({ ...context, dataDim })
          }}
        >
          {DATA_DIM_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        特徴抽出手法
        <select
          value={context.method}
          onChange={(event) => {
            const method = findOption<FeatureMethod>(FEATURE_METHOD_OPTIONS, event.target.value)
            if (method !== undefined) setContext({ ...context, method })
          }}
        >
          {FEATURE_METHOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.group}>
        <button
          type="button"
          title="保存ファイル(JSON)をダウンロードする(Ctrl+S)"
          onClick={() => {
            void save()
          }}
        >
          保存
        </button>
        <button
          type="button"
          title="保存ファイル、または学習の設定ファイル(JSON)を開く"
          onClick={() => {
            void open()
          }}
        >
          読込
        </button>
      </div>
      <span className={styles.documentName}>
        {name}
        {isDirty && (
          <span className={styles.dirty} title="保存していない変更があります">
            ● 未保存
          </span>
        )}
      </span>

      <div className={styles.spacer} />

      <DeviceStatus />
      <button
        type="button"
        title="学習済みのモデルを選んで、学習を続ける"
        onClick={() => {
          void navigate('/models')
        }}
      >
        モデル一覧
      </button>
      <button
        type="button"
        className={styles.primary}
        onClick={() => {
          void navigate('/training')
        }}
      >
        学習開始
      </button>
    </header>
  )
}
