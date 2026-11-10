import { useEffect, useState } from 'react'

import type { ApiError } from '../../../application/ports/api-result'
import type { Capabilities } from '../../../entity/capabilities/capabilities'
import { useDependencies } from '../../app/dependencies'

/**
 * 使えるデバイスの一覧(capabilities API)を取得するフック。
 *
 * ヘッダのデバイス表示と、学習設定画面の device の選択肢・整合性チェックの両方で使う。
 * 取得できなくても(学習エンジンが止まっている等)画面は止めず、状態として返す。
 */

export type CapabilitiesState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly capabilities: Capabilities }
  | { readonly status: 'error'; readonly error: ApiError }

export function useCapabilities(): CapabilitiesState {
  const { capabilitiesApi } = useDependencies()
  const [state, setState] = useState<CapabilitiesState>({ status: 'loading' })

  useEffect(() => {
    // 取得の途中で画面が外れたら、結果を捨てる(外れた部品の state を書き換えないため)
    let cancelled = false
    void capabilitiesApi.getCapabilities().then((result) => {
      if (cancelled) return
      setState(
        result.ok
          ? { status: 'ready', capabilities: result.value }
          : { status: 'error', error: result.error },
      )
    })
    return () => {
      cancelled = true
    }
  }, [capabilitiesApi])

  return state
}
