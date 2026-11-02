import { apiOk } from '../../application/ports/api-result'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import type { Dependencies } from '../app/dependencies'

/**
 * テスト用の偽物の依存一式(テストからだけ使う)。
 *
 * 画面のテストは Context に Dependencies を渡して描く。ポートが増えるたびに各テストの
 * 偽物を書き足すと、どれかを忘れて型エラーになる(フェーズ 4・5 で実際に起きた)。
 * 既定の偽物をここ 1 か所にまとめ、テストは確かめたいポートだけを上書きする。
 *
 * 既定の振る舞いは「何事もなく成功する」:カタログは MVP のもの、GPU なし、
 * 保存は成功・読込はキャンセル、学習開始は job-1、進捗は何も届かない、停止の要求は成功。
 */
export function fakeDependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    nodeCatalogSource: { load: () => Promise.resolve(apiOk(defaultNodeCatalog)) },
    capabilitiesApi: {
      getCapabilities: () =>
        Promise.resolve(
          apiOk({ cudaAvailable: false, devices: [{ name: 'CPU', index: 0, type: 'cpu' }] }),
        ),
    },
    documentStorage: {
      save: () => Promise.resolve({ ok: true }),
      open: () => Promise.resolve({ kind: 'cancelled' }),
    },
    trainingApi: {
      start: () => Promise.resolve(apiOk({ jobId: 'job-1', status: 'running' })),
      subscribeProgress: () => () => undefined,
      stop: () => Promise.resolve(apiOk('running')),
    },
    ...overrides,
  }
}
