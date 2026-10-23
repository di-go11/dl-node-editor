import type { IntParamDef } from '../node-catalog/param-def'

import type { DataSpec } from './data-spec'
import { defaultImageDataSpec } from './data-spec'
import type { LossConfig } from './loss'
import { DEFAULT_LOSS_KIND, LOSS_TYPES } from './loss'
import type { OptimizerConfig } from './optimizer'
import { DEFAULT_OPTIMIZER_KIND, OPTIMIZER_TYPES } from './optimizer'
import { defaultVariant } from './variant'

/**
 * 学習設定。training.proto の StartTrainingRequest から model_graph を除いたもの。
 *
 * model_graph を含めないのは、モデル構造はノードエディタが、学習設定は学習設定画面が
 * 持つ別々の状態だからである。2 つを合わせて StartTrainingRequest にするのは、
 * 送る直前(proto-json/convert.ts の toStartTrainingRequestJson)だけにする。
 * 保存ファイル(指示書 7.2)でも model と training は別の項目になっている。
 *
 * フィールド名はエンティティの慣習(camelCase)にし、JSON 表記(snake_case)との
 * 対応は proto-json/ に閉じ込める(1a の ModelGraph と同じ方針)。
 */
export type TrainingSettings = {
  /** checkpoint のファイル名(<model_name>_last.pt)に使われる */
  readonly modelName: string
  readonly optimizer: OptimizerConfig
  readonly loss: LossConfig
  readonly epoch: number
  readonly batch: number
  /** 学習エンジンから見たサーバー上のパス */
  readonly datasetPath: string
  /** 'cpu' / 'cuda' / 'cuda:0' のような文字列。capabilities API の結果から選ぶ */
  readonly device: string
  readonly dataSpec: DataSpec
  /** checkpoint を保存する間隔(エポック)。0 なら毎エポック */
  readonly saveLastEvery: number
  /** 再開元の checkpoint のパス。空文字なら再開しない */
  readonly resumeFrom: string
  /**
   * 乱数シード。null なら固定しない。
   *
   * proto では 0 も有効な値なので、uint64 をそのまま持たず Seed メッセージで包んでいる。
   * ここでは number | null で同じ区別を表す(JSON では null のとき seed のキーごと省く)。
   */
  readonly seed: number | null
}

/**
 * model_name に使える文字。C++ 側(TrainingProtoMapper.cpp の validateModelName)と同じ規則。
 * ファイル名に使われるため、パスの区切りや空白を含められない。
 */
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * device の書式。C++ 側(ComputeDevice.hpp の parseComputeDevice)が受け付ける形と同じ。
 * capabilities の一覧が手元にないときの、最低限の確認に使う。
 */
export const DEVICE_PATTERN = /^(cpu|cuda(:\d+)?)$/

/**
 * seed の上限。
 *
 * proto は uint64(最大 2^64 - 1)だが、JavaScript の number は 2^53 を超えると
 * 整数を正確に表せない(倍精度浮動小数点数の仮数部が 53 ビットのため)。
 * それより大きい値を入れると、送る前に黙って別の値に丸まってしまう。
 * 「再現性のためのシード」が気づかないうちに変わるのは最悪なので、ここで上限を切る。
 */
export const MAX_SEED = Number.MAX_SAFE_INTEGER

/**
 * 数値の項目の制約。キーは JSON 表記の名前(検証で Issue の field に使う)。
 * 制約をここ 1 か所に置き、検証と学習設定画面の入力欄の両方がここを読む。
 */
export const TRAINING_NUMBER_DEFS = {
  epoch: {
    kind: 'int',
    label: 'エポック数',
    default: 10,
    min: 1,
    help: '学習データ全体を何周するか。',
  },
  batch: {
    kind: 'int',
    label: 'バッチサイズ',
    default: 8,
    min: 1,
    help: '1 回の更新に使う画像の枚数。GPU のメモリが足りなければ減らす。',
  },
  save_last_every: {
    kind: 'int',
    label: '保存間隔(エポック)',
    default: 0,
    min: 0,
    help: 'checkpoint を保存する間隔。0 なら毎エポック保存する。',
  },
  seed: {
    kind: 'int',
    label: '乱数シード',
    default: 0,
    min: 0,
    max: MAX_SEED,
    help: '同じ値にすると、同じ初期値・同じデータの順番で学習を再現できる。',
  },
} satisfies Record<string, IntParamDef>

/**
 * 学習設定の初期値。
 *
 * device は空にしておく。使えるデバイスは capabilities API に問い合わせるまで分からず、
 * ここで 'cuda:0' と決め打ちすると、GPU のない環境でそのまま失敗するためである。
 * 空のままなら、検証が「device を選んでください」と知らせる。
 */
export function defaultTrainingSettings(): TrainingSettings {
  return {
    modelName: 'model',
    optimizer: defaultVariant(OPTIMIZER_TYPES, DEFAULT_OPTIMIZER_KIND),
    loss: defaultVariant(LOSS_TYPES, DEFAULT_LOSS_KIND),
    epoch: TRAINING_NUMBER_DEFS.epoch.default,
    batch: TRAINING_NUMBER_DEFS.batch.default,
    datasetPath: '',
    device: '',
    dataSpec: defaultImageDataSpec(),
    saveLastEvery: TRAINING_NUMBER_DEFS.save_last_every.default,
    resumeFrom: '',
    seed: null,
  }
}
