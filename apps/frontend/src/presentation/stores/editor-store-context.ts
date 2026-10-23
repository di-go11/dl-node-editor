import { createContext, useContext } from 'react'
import { useStore } from 'zustand'

import type { EditorStore, EditorStoreState } from './editor-store'

/**
 * エディタのストアを React に配るための Context。
 *
 * ストアの作成(カタログの読み込みを待つ)は presentation/app/EditorSession.tsx が行う。
 * ストアはルーティング(画面遷移)より外側に置く。エディタ → 学習設定 → エディタと
 * 移動しても、組み立て途中のグラフが消えないようにするためである(指示書 3 章)。
 *
 * React 19 では `<EditorStoreContext value={store}>` と書けば Provider になるので、
 * Provider 専用のコンポーネントは作っていない。
 */
export const EditorStoreContext = createContext<EditorStore | null>(null)

export function useEditorStoreApi(): EditorStore {
  const store = useContext(EditorStoreContext)
  if (store === null) {
    throw new Error('EditorStoreContext の外で useEditorStore が呼ばれました')
  }
  return store
}

/**
 * ストアの一部を選んで購読する。選んだ値が変わったときだけ再描画される。
 *
 * 注意: selector が毎回新しいオブジェクトや配列を作ると、値が変わっていなくても
 * 「変わった」と判定されて再描画が止まらなくなる。複数の値を取り出すときは、
 * 1 つずつ呼ぶか、zustand/shallow の useShallow で包む。
 */
export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
  return useStore(useEditorStoreApi(), selector)
}
