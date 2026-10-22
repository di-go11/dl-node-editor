import { describe, expect, it } from 'vitest'

// Vite の ?raw は、ファイルの中身を文字列として読み込む指定。
// node:fs を使わないのは、tsconfig.app.json(ブラウザ向け)に Node の型を
// 持ち込まずに済むためである。ブラウザのコードが fs を参照できないことは、
// 型の上でも保たれていたほうがよい。
import exampleRaw from '../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'

import type { components } from './schema'

type StartTrainingRequest = components['schemas']['StartTrainingRequest']

/**
 * 契約(openapi.yaml)が、実際に C++ が受け付ける JSON の実例と一致していることを確かめる。
 *
 * なぜこのテストが必要か:
 *   openapi.yaml は手で書く契約であり、proto から自動生成したものではない。
 *   そのため「契約のつもりで書いた形」と「実際に通る形」がずれうる。
 *   そこで実例ファイル(test_segnet_dag.json)を正として、次の 2 つを同時に検査する。
 *
 *   1. コンパイル時: 下の expected を StartTrainingRequest 型として宣言しているため、
 *      型が実例の形を受け付けられなければ tsc が失敗する。
 *      フィールド名の綴り、enum の文字列、required の指定の誤りがここで出る。
 *   2. 実行時: 実例ファイルを読み、expected と深く比較する。
 *      実例ファイルが変わったら(= 契約を更新すべきときに)このテストが落ちる。
 *
 * 型だけの検査にしないのは、JSON を import すると TypeScript が文字列を
 * リテラル型ではなく string として推論し、enum の綴り違いを見逃すためである。
 */

// test_segnet_dag.json と同じ内容を、生成された型の注釈付きで書き写したもの。
const expected: StartTrainingRequest = {
  model_name: 'test_segnet',
  model_graph: {
    nodes: [
      {
        id: 'conv1',
        spec: {
          conv2d: {
            in_channels: 3,
            out_channels: 64,
            kernel_size: 3,
            stride: 1,
            padding: 1,
            dilation: 1,
          },
        },
        // source が {} なのはグラフ入力(画像)を意味する
        inputs: [{ port: 'x', source: {} }],
      },
      {
        id: 'relu1',
        spec: { activation: { activation_type: 'ACTIVATION_TYPE_RELU', dim: 1 } },
        inputs: [{ port: 'x', source: { node_id: 'conv1', port: 'y' } }],
      },
      {
        id: 'bn1',
        spec: { batch_norm: { num_features: 64, eps: 1e-5, momentum: 0.5 } },
        inputs: [{ port: 'x', source: { node_id: 'relu1', port: 'y' } }],
      },
      {
        id: 'pool1',
        spec: { indexed_pooling: { kernel_size: 2, stride: 2, padding: 0 } },
        inputs: [{ port: 'x', source: { node_id: 'bn1', port: 'y' } }],
      },
      {
        id: 'unpool1',
        spec: { unpooling: { kernel_size: 2, stride: 2, padding: 0 } },
        // Unpooling だけは入力ポートが 2 つ(x と indices)ある
        inputs: [
          { port: 'x', source: { node_id: 'pool1', port: 'y' } },
          { port: 'indices', source: { node_id: 'pool1', port: 'indices' } },
        ],
      },
      {
        id: 'out_conv',
        spec: {
          conv2d: {
            in_channels: 64,
            out_channels: 3,
            kernel_size: 3,
            stride: 1,
            padding: 1,
            dilation: 1,
          },
        },
        inputs: [{ port: 'x', source: { node_id: 'unpool1', port: 'y' } }],
      },
    ],
    outputs: [{ node_id: 'out_conv', port: 'y' }],
  },
  optimizer: {
    adam: {
      learning_rate: 0.001,
      weight_decay: 0.0,
      beta1: 0.9,
      beta2: 0.999,
      eps: 1e-8,
    },
  },
  loss: { cross_entropy: {} },
  epoch: 1,
  batch: 6,
  dataset_path: '/workspaces/apps/backend/ai-engine/TrainingDataset/',
  device: 'cuda:0',
  data_spec: {
    image: {
      annotation: { pascal_voc: { include_difficult: false } },
      input_width: 256,
      input_height: 256,
      task_specs: { segmentation: { ignore_index: 255 } },
    },
  },
  save_last_every: 0,
  resume_from: '',
  seed: { value: 0 },
}

describe('openapi.yaml の StartTrainingRequest', () => {
  it('test_segnet_dag.json と同じ形を表している', () => {
    const actual: unknown = JSON.parse(exampleRaw)

    expect(actual).toEqual(expected)
  })

  it('ノードの並び順を保っている(重みの初期化と checkpoint の対応がこの順で決まる)', () => {
    expect(expected.model_graph.nodes.map((node) => node.id)).toEqual([
      'conv1',
      'relu1',
      'bn1',
      'pool1',
      'unpool1',
      'out_conv',
    ])
  })
})
