import { useCallback, useEffect, useState } from 'react'

import type { DatasetSummary } from '../../../entity/dataset/dataset'
import { useDependencies } from '../../app/dependencies'

/**
 * 登録済みデータセットの一覧(GET /datasets)を取得するフック。学習設定画面のデータセットの選択肢に使う。
 *
 * 取得に失敗しても画面は止めず、状態として返す。reload で取得し直せる
 * (データセットを別の画面・別のタブでアップロードした後など)。
 */

export type DatasetsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly datasets: readonly DatasetSummary[] }
  | { readonly status: 'error'; readonly message: string }

export type UseDatasets = {
  readonly state: DatasetsState
  readonly reload: () => void
}

export function useDatasets(): UseDatasets {
  const { datasetApi } = useDependencies()
  const [state, setState] = useState<DatasetsState>({ status: 'loading' })
  // 取得し直すたびに増やし、effect を走らせ直す
  const [requestCount, setRequestCount] = useState(0)

  useEffect(() => {
    // 取得の途中で画面が外れたり、取得し直したりしたら、古い結果を捨てる
    let cancelled = false
    void datasetApi.list().then((result) => {
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', datasets: result.value }
          : { status: 'error', message: result.error.message },
      )
    })
    return () => {
      cancelled = true
    }
  }, [datasetApi, requestCount])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setRequestCount((count) => count + 1)
  }, [])

  return { state, reload }
}
