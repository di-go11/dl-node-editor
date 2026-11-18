import type { IntParamDef } from '../param/param-def'

import type { Variant, VariantDef } from './variant'
import { defaultVariant } from './variant'

/**
 * データの仕様。training.proto の DataSpec / ImageSpec に対応する。
 *
 *   DataSpec(oneof: 今は image だけ)
 *     └ ImageSpec
 *         ├ annotation   … アノテーションの形式(oneof: pascal_voc / original)
 *         ├ input_width / input_height
 *         └ task_specs   … タスク(oneof: segmentation / object_detection / classification)
 *
 * 2 つの oneof(annotation と task_specs)は「種類 + パラメータ袋」の形なので、
 * optimizer や loss と同じくバリアントのカタログにしている。
 *
 * DataSpec そのものは判別可能合併(kind で区別する合併型)にしている。
 * 今は 'image' しかないが、1D のデータ(指示書 4.3 で近日実装予定)が proto に
 * 追加されたとき、合併に 1 つ足せば、switch の網羅性検査が対応漏れを教えてくれる。
 */

export const ANNOTATION_TYPES = {
  pascal_voc: {
    label: 'Pascal VOC',
    description:
      '本家 Pascal VOC 形式のデータセット。マスクの色は VOC のカラーマップ(21 クラス)で読み、labelmap.txt は使いません。',
    params: {
      include_difficult: {
        kind: 'bool',
        label: 'difficult を含める',
        default: false,
        help: '「判定が難しい」と印の付いた例も学習に使う。',
      },
    },
  },
  original: {
    label: 'Original(labelmap.txt)',
    description:
      'VOC と同じフォルダ構成で、色とクラスの対応を labelmap.txt で決める独自形式(CVAT の Segmentation mask 書き出しなど)。',
    params: {},
  },
} satisfies Record<string, VariantDef>

export type AnnotationKind = keyof typeof ANNOTATION_TYPES

/**
 * タスク 1 種類の定義。学習エンジンが対応しているか(available)を持つ。
 *
 * 1D のノード(editor-context.ts)と同じく、「選べるが、まだ使えない」をデータで表す。
 * 今の C++ はセグメンテーションだけを学習できる(クラス分類と物体検出は、データセットの
 * 読み込みと評価で「まだ対応していません」の例外になる)。未対応のタスクを選ぶと、
 * 整合性チェックで error にする。C++ が対応したら available を true にするだけでよい。
 */
export type ImageTaskDef = VariantDef & {
  readonly available: boolean
  readonly note?: string
}

const ENGINE_NOT_READY = '学習エンジン(C++)がまだ対応していません'

/** 無視する色の 1 成分。ignore_color_enabled がオンのときだけ入力欄を出す */
const ignoreColorDef = (channel: 'R' | 'G' | 'B', defaultValue: number): IntParamDef => ({
  kind: 'int',
  label: `無視する色の ${channel}`,
  default: defaultValue,
  min: 0,
  max: 255,
  enabledBy: 'ignore_color_enabled',
})

export const IMAGE_TASK_TYPES = {
  segmentation: {
    label: 'セグメンテーション',
    description: '画素ごとにクラスを当てる。',
    params: {
      ignore_index: {
        kind: 'int',
        label: '無視するラベル値',
        default: 255,
        min: 0,
        max: 255,
        help: '損失の計算と評価から除外するラベル値。下の「無視する色」の画素と、リサイズの余白がこの値になる。実在するクラス ID と重ならない値にする。',
      },
      ignore_color_enabled: {
        kind: 'bool',
        label: '無視する色を指定する',
        default: true,
        help: 'マスク画像でこの色の画素を「無視するラベル値」に変換する。Pascal VOC の境界・difficult 領域(void)は 224, 224, 192。オフにすると、labelmap にない色があった時点で学習を止める。',
      },
      ignore_color_r: ignoreColorDef('R', 224),
      ignore_color_g: ignoreColorDef('G', 224),
      ignore_color_b: ignoreColorDef('B', 192),
    },
    available: true,
  },
  object_detection: {
    label: '物体検出',
    description: '物体の位置(矩形)とクラスを当てる。',
    params: {},
    available: false,
    note: ENGINE_NOT_READY,
  },
  classification: {
    label: 'クラス分類',
    description: '画像 1 枚ごとにクラスを当てる。',
    params: {},
    available: false,
    note: ENGINE_NOT_READY,
  },
} satisfies Record<string, ImageTaskDef>

export type ImageTaskKind = keyof typeof IMAGE_TASK_TYPES

/**
 * 入力画像の大きさの制約。キーは JSON 表記の名前にしてある
 * (検証で Issue の field に 'data_spec.image.input_width' と書くため)。
 */
const imageSizeDef = (label: string): IntParamDef => ({
  kind: 'int',
  label,
  default: 256,
  min: 1,
  help: '学習の前に、画像をこの大きさに揃える。',
})

export const IMAGE_SIZE_DEFS = {
  input_width: imageSizeDef('入力画像の幅'),
  input_height: imageSizeDef('入力画像の高さ'),
} as const

export type ImageDataSpec = {
  readonly kind: 'image'
  readonly annotation: Variant<AnnotationKind>
  readonly inputWidth: number
  readonly inputHeight: number
  readonly task: Variant<ImageTaskKind>
}

/** データの種類。proto の DataSpec の oneof フィールド名と一致させる */
export const DATA_SPEC_KINDS = ['image'] as const

export type DataSpecKind = (typeof DATA_SPEC_KINDS)[number]

export const DATA_SPEC_KIND_LABELS: Readonly<Record<DataSpecKind, string>> = {
  image: '画像',
}

/** 今は ImageDataSpec だけ。データの種類が増えたら、ここに合併で足す */
export type DataSpec = ImageDataSpec

export const DEFAULT_ANNOTATION_KIND: AnnotationKind = 'pascal_voc'
export const DEFAULT_IMAGE_TASK_KIND: ImageTaskKind = 'segmentation'

export function defaultImageDataSpec(): ImageDataSpec {
  return {
    kind: 'image',
    annotation: defaultVariant(ANNOTATION_TYPES, DEFAULT_ANNOTATION_KIND),
    inputWidth: IMAGE_SIZE_DEFS.input_width.default,
    inputHeight: IMAGE_SIZE_DEFS.input_height.default,
    task: defaultVariant(IMAGE_TASK_TYPES, DEFAULT_IMAGE_TASK_KIND),
  }
}
