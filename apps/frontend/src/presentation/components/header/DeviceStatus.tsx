import { deviceIdOf, primaryDevice } from '../../../entity/capabilities/capabilities'

import styles from './Header.module.css'
import { useCapabilities } from './use-capabilities'

/**
 * ヘッダのデバイス表示(指示書 4.2「デバイス: CUDA ✓ (cuda:0)」)。
 *
 * capabilities API の結果を出す。取得できなくても(学習エンジンが止まっている等)
 * エディタでの編集は続けられるので、エラーで画面を止めず、ここに理由を出すだけにする。
 */

export function DeviceStatus() {
  const state = useCapabilities()

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
