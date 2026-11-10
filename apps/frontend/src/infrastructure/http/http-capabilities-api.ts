import { z } from 'zod'

import type { CapabilitiesApi } from '../../application/ports/capabilities-api'
import type { Capabilities, DeviceInfo } from '../../entity/capabilities/capabilities'

import type { ApiClient } from './api-client'
import { callApi } from './api-client'

/**
 * CapabilitiesApi の HTTP 実装(GET /capabilities)。
 *
 * 応答の Zod スキーマをエンティティ層ではなくここに置いているのは、この形が
 * HTTP の応答としてしか現れないからである。モデル構造や学習設定の JSON は
 * C++ の設定ファイルや保存ファイルにも使う「共通語」なのでエンティティ層に置いたが、
 * capabilities はそうではない(1a・1d の判断と同じ基準で分けている)。
 */

const capabilitiesJsonSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
})

type CapabilitiesJson = z.infer<typeof capabilitiesJsonSchema>

const CUDA_DEVICE_ID = /^cuda:(\d+)$/

/** 応答には id しかないので、種類と番号は id('cpu' / 'cuda:0')から読み取る */
function deviceFromJson(json: CapabilitiesJson['devices'][number]): DeviceInfo {
  if (json.id === 'cpu') return { name: json.name, index: 0, type: 'cpu' }
  const cuda = CUDA_DEVICE_ID.exec(json.id)
  if (cuda !== null) return { name: json.name, index: Number(cuda[1]), type: 'cuda' }
  return { name: json.name, index: 0, type: 'unspecified' }
}

function toCapabilities(json: CapabilitiesJson): Capabilities {
  const devices = json.devices.map(deviceFromJson)
  return {
    cudaAvailable: devices.some((device) => device.type === 'cuda'),
    devices,
  }
}

export function createHttpCapabilitiesApi(client: ApiClient): CapabilitiesApi {
  return {
    getCapabilities: () =>
      callApi(() => client.GET('/capabilities'), capabilitiesJsonSchema, toCapabilities),
  }
}
