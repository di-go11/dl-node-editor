import { useEffect, useState } from 'react'

import type { ApiError } from '../../../application/ports/api-result'
import type { Capabilities } from '../../../entity/capabilities/capabilities'
import { deviceIdOf, primaryDevice } from '../../../entity/capabilities/capabilities'
import { useDependencies } from '../../app/dependencies'

import styles from './Header.module.css'

/**
 * ヘッダのデバイス表示(指示書 4.2「デバイス: CUDA ✓ (cuda:0)」)。
 *
 * capabilities API の結果を出す。取得できなくても(学習エンジンが止まっている等)
 * エディタでの編集は続けられるので、エラーで画面を止めず、ここに理由を出すだけにする。
 */

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly capabilities: Capabilities }
  | { readonly status: 'error'; readonly error: ApiError }

export function DeviceStatus() {
  const { capabilitiesApi } = useDependencies()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
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

  switch (state.status) {
    case 'loading':
      return <span className={styles.device}>デバイス: 確認中…</span>
    case 'error':
      return (
        <span className={`${styles.device} ${styles.deviceError}`} title={state.error.message}>
          デバイス: 取得できません
        </span>
      )
    case 'ready': {
      const device = primaryDevice(state.capabilities)
      if (device === null) {
        return <span className={`${styles.device} ${styles.deviceError}`}>デバイス: なし</span>
      }
      const label =
        device.type === 'cuda' ? `CUDA ✓ (${deviceIdOf(device) ?? ''})` : 'CPU のみ(CUDA なし)'
      return (
        <span
          className={`${styles.device} ${device.type === 'cuda' ? styles.deviceOk : ''}`}
          title={device.name}
        >
          デバイス: {label}
        </span>
      )
    }
  }
}
