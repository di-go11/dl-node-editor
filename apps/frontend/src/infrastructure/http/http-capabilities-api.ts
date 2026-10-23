import { z } from 'zod'

import type { CapabilitiesApi } from '../../application/ports/capabilities-api'
import type { Capabilities, DeviceType } from '../../entity/capabilities/capabilities'

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
  cuda_available: z.boolean(),
  devices: z.array(
    z.object({
      device_name: z.string(),
      device_index: z.number().int().nonnegative(),
      device_type: z.enum(['DEVICE_TYPE_UNSPECIFIED', 'DEVICE_TYPE_CPU', 'DEVICE_TYPE_CUDA']),
    }),
  ),
})

type CapabilitiesJson = z.infer<typeof capabilitiesJsonSchema>

const DEVICE_TYPES: Readonly<
  Record<CapabilitiesJson['devices'][number]['device_type'], DeviceType>
> = {
  DEVICE_TYPE_UNSPECIFIED: 'unspecified',
  DEVICE_TYPE_CPU: 'cpu',
  DEVICE_TYPE_CUDA: 'cuda',
}

function toCapabilities(json: CapabilitiesJson): Capabilities {
  return {
    cudaAvailable: json.cuda_available,
    devices: json.devices.map((device) => ({
      name: device.device_name,
      index: device.device_index,
      type: DEVICE_TYPES[device.device_type],
    })),
  }
}

export function createHttpCapabilitiesApi(client: ApiClient): CapabilitiesApi {
  return {
    getCapabilities: () =>
      callApi(() => client.GET('/capabilities'), capabilitiesJsonSchema, toCapabilities),
  }
}
