import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { EditorStore } from '../stores/editor-store'
import { createEditorStore } from '../stores/editor-store'
import { EditorStoreContext } from '../stores/editor-store-context'

import { useDependencies } from './dependencies'

/**
 * エディタの作業の単位(セッション)。カタログを読み込み、ストアを作って配る。
 *
 * ルーティングより外側に置くので、画面を移動してもストア(組み立て途中のグラフ)は残る。
 * カタログの読み込みは非同期(将来 API から取得するため)なので、読み込み中と
 * 失敗の表示もここで受け持つ。
 */

type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly store: EditorStore }

export function EditorSession({ children }: { readonly children: ReactNode }) {
  const { nodeCatalogSource } = useDependencies()
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    // 読み込みの途中でこのコンポーネントが外れたら、結果を捨てる。
    // StrictMode の開発時は effect が 2 回走るので、1 回目の結果で上書きしないためにも要る
    let cancelled = false
    void nodeCatalogSource.load().then((result) => {
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', store: createEditorStore({ catalog: result.value }) }
          : { status: 'error', message: result.error.message },
      )
    })
    return () => {
      cancelled = true
    }
  }, [nodeCatalogSource])

  switch (state.status) {
    case 'loading':
      return <p role="status">ノードカタログを読み込んでいます…</p>
    case 'error':
      return <p role="alert">ノードカタログを読み込めませんでした: {state.message}</p>
    case 'ready':
      return <EditorStoreContext value={state.store}>{children}</EditorStoreContext>
  }
}
