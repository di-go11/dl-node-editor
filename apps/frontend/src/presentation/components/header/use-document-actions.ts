import { useCallback, useEffect } from 'react'

import { openDocument } from '../../../application/usecases/open-document'
import { saveDocument } from '../../../application/usecases/save-document'
import { useDependencies } from '../../app/dependencies'
import { isDocumentDirty } from '../../stores/editor-store'
import { useEditorStore, useEditorStoreApi } from '../../stores/editor-store-context'

/**
 * [保存] / [読込] の操作。ユースケース(application 層)とストアとログをつなぐフック。
 *
 * ユースケースは「保存ファイルを作って保存先に渡す」「読んで検証する」までを受け持つ。
 * このフックは、その結果を画面に反映する部分(ストアの更新、ログへのメッセージ、
 * 確認のダイアログ)だけを受け持つ。
 *
 * ## 確認ダイアログを出す順番
 *
 * 保存していない変更があるときの「破棄してよいか」の確認は、**ファイルを選んで検証が
 * 通ったあと**に出す。先に確認を出すと、利用者が答えるのに時間がかかった場合に、
 * ブラウザが「利用者の操作の直後ではない」と判断してファイル選択を開かないことがある
 * (ファイル選択はクリックから数秒以内にしか開けない)。
 * また、不正なファイルを選んだときは今の作業を消さないので、確認自体が要らない。
 */

/** 確認ダイアログ。テストで差し替えられるよう、引数で受け取れるようにしている */
export type ConfirmFn = (message: string) => boolean

// コンポーネントの外で 1 度だけ作る。既定の引数に直接書くと描画のたびに別の関数になり、
// useCallback の依存が毎回変わってしまう
const browserConfirm: ConfirmFn = (message) => window.confirm(message)

export function useDocumentActions(confirm: ConfirmFn = browserConfirm) {
  const store = useEditorStoreApi()
  const { documentStorage } = useDependencies()
  const isDirty = useEditorStore(isDocumentDirty)

  const save = useCallback(async () => {
    const { document, addMessages, markSaved } = store.getState()
    const result = await saveDocument({ storage: documentStorage, now: () => new Date() }, document)
    if (result.ok) {
      markSaved(document, result.savedAt)
      addMessages([{ level: 'info', text: `${result.fileName} として保存しました。` }])
    } else {
      addMessages([{ level: 'error', text: result.message }])
    }
  }, [store, documentStorage])

  const open = useCallback(async () => {
    // await より前に storage.open() が呼ばれる(ファイル選択を利用者の操作の直後に開くため)
    const result = await openDocument({ storage: documentStorage })
    const { addMessages, replaceDocument } = store.getState()

    switch (result.kind) {
      case 'cancelled':
        return
      case 'failed':
        addMessages([{ level: 'error', text: result.message }])
        return
      case 'invalid':
        // 何がおかしいかを、パス付きで 1 件ずつ出す(指示書 7.2)。今の作業はそのまま残す
        addMessages([
          {
            level: 'error',
            text: `${result.fileName} を開けませんでした(問題 ${result.issues.length} 件)。今の作業はそのままです。`,
          },
          ...result.issues.map((issue) => ({ level: 'error' as const, text: issue.message })),
        ])
        return
      case 'opened': {
        if (
          isDocumentDirty(store.getState()) &&
          !confirm(`保存していない変更があります。破棄して ${result.fileName} を開きますか?`)
        ) {
          return
        }
        replaceDocument(result.document)
        addMessages([
          {
            level: 'info',
            text:
              result.source === 'training-config'
                ? `${result.fileName} を学習の設定ファイルとして取り込みました。ノードの位置は自動で配置しています。`
                : `${result.fileName} を開きました。`,
          },
        ])
        return
      }
    }
  }, [store, documentStorage, confirm])

  return { save, open, isDirty }
}

/**
 * 保存していない変更があるときに、タブを閉じる・再読み込みする前にブラウザの警告を出す。
 *
 * beforeunload イベントで preventDefault すると、ブラウザが「このページを離れますか?」と
 * 確認する(文言はブラウザが決め、ページからは変えられない)。
 * 変更がないときは登録しない。登録しているだけで、ブラウザの戻る/進むの高速化
 * (bfcache)が効かなくなるためである。
 */
export function useUnsavedChangesWarning(): void {
  const isDirty = useEditorStore(isDocumentDirty)

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [isDirty])
}
