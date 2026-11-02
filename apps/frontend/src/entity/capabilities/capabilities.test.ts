// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { DEVICE_PATTERN } from '../training/training-settings'

import type { Capabilities, DeviceInfo } from './capabilities'
import { deviceIdOf, primaryDevice, selectableDeviceIds } from './capabilities'

const cpu: DeviceInfo = { name: 'CPU', index: 0, type: 'cpu' }
const gpu0: DeviceInfo = { name: 'RTX 4070', index: 0, type: 'cuda' }
const gpu1: DeviceInfo = { name: 'RTX 4070', index: 1, type: 'cuda' }

describe('deviceIdOf', () => {
  it('CPU は番号を付けず cpu、GPU は cuda:<番号>', () => {
    expect(deviceIdOf(cpu)).toBe('cpu')
    expect(deviceIdOf(gpu1)).toBe('cuda:1')
  })

  it('作った文字列は C++ が受け付ける書式になっている', () => {
    for (const device of [cpu, gpu0, gpu1]) {
      expect(DEVICE_PATTERN.test(deviceIdOf(device) ?? '')).toBe(true)
    }
  })

  it('種類の分からないデバイスは指定できない', () => {
    expect(deviceIdOf({ name: '?', index: 0, type: 'unspecified' })).toBeNull()
  })
})

describe('selectableDeviceIds', () => {
  it('指定できるデバイスだけを、並び順のまま返す', () => {
    const capabilities: Capabilities = {
      cudaAvailable: true,
      devices: [cpu, { name: '?', index: 0, type: 'unspecified' }, gpu0, gpu1],
    }
    expect(selectableDeviceIds(capabilities)).toEqual(['cpu', 'cuda:0', 'cuda:1'])
  })
})

describe('primaryDevice', () => {
  it('GPU があれば最初の GPU', () => {
    expect(primaryDevice({ cudaAvailable: true, devices: [cpu, gpu0, gpu1] })).toBe(gpu0)
  })

  it('GPU がなければ CPU、何もなければ null', () => {
    expect(primaryDevice({ cudaAvailable: false, devices: [cpu] })).toBe(cpu)
    expect(primaryDevice({ cudaAvailable: false, devices: [] })).toBeNull()
  })
})
