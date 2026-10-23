import { createContext, useContext } from 'react'

import type { CapabilitiesApi } from '../../application/ports/capabilities-api'
import type { DocumentStorage } from '../../application/ports/document-storage'
import type { NodeCatalogSource } from '../../application/ports/node-catalog-source'

/**
 * 画面が使う外部とのやり取り(ポート)の一覧。
 *
 * ## 依存性注入(DI)
 *
 * 画面のコードは「capabilities を取得する何か」(CapabilitiesApi)だけを知っていて、
 * それが本物の HTTP なのか、テスト用の偽物なのかを知らない。どの実装を渡すかは
 * コンポジションルート(main.tsx)だけが決め、この Context で配る。
 *
 *   main.tsx ──組み立て──▶ Dependencies ──Context──▶ 画面(useDependencies)
 *
 * こうすると、
 *   - テストでは偽物の実装を Context に渡すだけで、通信なしに画面を検査できる
 *   - presentation 層が infrastructure 層を import しなくて済む
 *     (dependency-cruiser のルール presentation-not-to-infrastructure で検査している)
 *
 * React 19 では `<DependenciesContext value={...}>` と書けば Provider になる。
 */
export type Dependencies = {
  readonly nodeCatalogSource: NodeCatalogSource
  readonly capabilitiesApi: CapabilitiesApi
  readonly documentStorage: DocumentStorage
}

export const DependenciesContext = createContext<Dependencies | null>(null)

export function useDependencies(): Dependencies {
  const dependencies = useContext(DependenciesContext)
  if (dependencies === null) {
    throw new Error('DependenciesContext の外で useDependencies が呼ばれました')
  }
  return dependencies
}
