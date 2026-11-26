import { apiOk } from '../../application/ports/api-result'
import type { DatasetSummary } from '../../entity/dataset/dataset'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { defaultTrainingSettings } from '../../entity/training/training-settings'
import type { Dependencies } from '../app/dependencies'

/**
 * テスト用の偽物の依存一式(テストからだけ使う)。
 *
 * 画面のテストは Context に Dependencies を渡して描く。ポートが増えるたびに各テストの
 * 偽物を書き足すと、どれかを忘れて型エラーになる(フェーズ 4・5 で実際に起きた)。
 * 既定の偽物をここ 1 か所にまとめ、テストは確かめたいポートだけを上書きする。
 *
 * 既定の振る舞いは「何事もなく成功する」:カタログは MVP のもの、GPU なし、
 * 保存は成功・読込はキャンセル、整合性チェックのサーバー側は OK、学習開始は job-1、
 * 進捗は何も届かない、停止の要求は成功。学習済みモデルは 0 件、再開は job-1。
 * データセットは FAKE_DATASETS の 1 件で、アップロードは成功する。
 */
/** 偽物のデータセット一覧(既定で 1 件) */
export const FAKE_DATASETS: readonly DatasetSummary[] = [
  {
    datasetId: 'dataset-voc',
    name: 'VOC2012',
    type: 'pascal_voc',
    createdAt: '2026-11-01T00:00:00Z',
  },
]

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
      validate: () => Promise.resolve(apiOk({ kind: 'ok' })),
      start: () => Promise.resolve(apiOk({ jobId: 'job-1', status: 'running' })),
      subscribeProgress: () => () => undefined,
      stop: () => Promise.resolve(apiOk('running')),
    },
    trainedModelApi: {
      list: () => Promise.resolve(apiOk([])),
      getConfig: () => Promise.resolve(apiOk(defaultTrainingSettings())),
      getHistory: (modelId) => Promise.resolve(apiOk({ modelId, modelName: 'model', runs: [], epochs: [] })),
      resume: () => Promise.resolve(apiOk({ jobId: 'job-1', status: 'running' })),
    },
    datasetApi: {
      list: () => Promise.resolve(apiOk(FAKE_DATASETS)),
      upload: () => Promise.resolve(apiOk(null)),
    },
    ...overrides,
  }
}
