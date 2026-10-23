/**
 * 学習エンジンが使えるデバイス。capabilities.proto の CapabilitiesResponse に対応する。
 *
 * エディタ画面のヘッダのデバイス表示と、学習設定画面の device の選択肢に使う。
 */

export type DeviceType = 'cpu' | 'cuda' | 'unspecified'

export type DeviceInfo = {
  /** 表示用の名前(例 NVIDIA GeForce RTX 4070) */
  readonly name: string
  /** 同じ種類のデバイスの通し番号。cuda:0 の 0 */
  readonly index: number
  readonly type: DeviceType
}

export type Capabilities = {
  readonly cudaAvailable: boolean
  readonly devices: readonly DeviceInfo[]
}

/**
 * StartTrainingRequest.device に入れる文字列にする('cpu' / 'cuda:0')。
 *
 * C++ の computeDeviceToString と同じ書き方にしている。CPU は番号を付けない
 * (C++ の parseComputeDevice は 'cpu:0' を受け付けない)。
 * 種類が分からないデバイスは指定できないので null を返す。
 */
export function deviceIdOf(device: DeviceInfo): string | null {
  switch (device.type) {
    case 'cpu':
      return 'cpu'
    case 'cuda':
      return `cuda:${device.index}`
    case 'unspecified':
      return null
  }
}

/** 学習設定で選べる device の文字列の一覧(capabilities の結果から作る) */
export function selectableDeviceIds(capabilities: Capabilities): readonly string[] {
  return capabilities.devices.map(deviceIdOf).filter((id): id is string => id !== null)
}

/**
 * ヘッダに出す「主なデバイス」。GPU があれば最初の GPU、なければ CPU。
 * 学習は普通 GPU で行うので、使える GPU があるかどうかを一目で分かるようにする。
 */
export function primaryDevice(capabilities: Capabilities): DeviceInfo | null {
  return (
    capabilities.devices.find((device) => device.type === 'cuda') ??
    capabilities.devices.find((device) => device.type === 'cpu') ??
    null
  )
}
