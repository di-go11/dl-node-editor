import type { ApiResult } from '../../application/ports/api-result'
import { apiOk } from '../../application/ports/api-result'
import type { NodeCatalogSource } from '../../application/ports/node-catalog-source'
import type { NodeCatalog } from '../../entity/node-catalog/catalog'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'

/**
 * NodeCatalogSource の固定データ実装。フロントに書いた MVP のカタログをそのまま返す。
 *
 * 将来 C++ からカタログを取得するようになったら、HTTP 実装を別に作り、
 * コンポジションルート(main.tsx)で差し替える。画面側は変えずに済む。
 */
export function createStaticNodeCatalogSource(
  catalog: NodeCatalog = defaultNodeCatalog,
): NodeCatalogSource {
  return {
    load: (): Promise<ApiResult<NodeCatalog>> => Promise.resolve(apiOk(catalog)),
  }
}
