import { describe, expect, it } from 'vitest'

// Vite の ?raw は、ファイルの中身を文字列として読み込む指定。
// node:fs を使わないのは、tsconfig.app.json(ブラウザ向け)に Node の型を
// 持ち込まずに済むためである。ブラウザのコードが fs を参照できないことは、
// 型の上でも保たれていたほうがよい。
import exampleRaw from '../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'

import { startTrainingRequestJsonSchema } from '../entity/training/proto-json/schema'
import { toRustStartTrainingRequest } from '../infrastructure/http/rust-training-request'

import type { components } from './schema'

type StartTrainingRequest = components['schemas']['StartTrainingRequest']

/**
 * C++ の設定ファイルの実例(test_segnet_dag.json)を HTTP 用に変換した結果が、
 * 契約(openapi.yaml)の形になることを確かめる。
 *
 * なぜこのテストが必要か:
 *   openapi.yaml は手で書く契約であり、proto や Rust の DTO から自動生成したものではない。
 *   そのため「契約のつもりで書いた形」と「実際に送る形」がずれうる。
 *   そこで実例ファイルを入力として、次の 2 つを同時に検査する。
 *
 *   1. コンパイル時: 下の expected を StartTrainingRequest 型として宣言しているため、
 *      型がこの形を受け付けられなければ tsc が失敗する。
 *      フィールド名の綴り、enum の文字列、required の指定の誤りがここで出る。
 *   2. 実行時: 実例ファイルを読んで変換し、expected と深く比較する。
 *      実例ファイルや変換が変わったらこのテストが落ちる。
 *
 * 型だけの検査にしないのは、JSON を import すると TypeScript が文字列を
 * リテラル型ではなく string として推論し、enum の綴り違いを見逃すためである。
 */

// test_segnet_dag.json を HTTP の形で書いたもの。生成された型の注釈を付けている。
const expected: StartTrainingRequest = {
  model_name: 'test_segnet',
  model_graph: {
    nodes: [
      {
        id: 'conv1',
        spec: {
          type: 'conv2d',
          in_channels: 3,
          out_channels: 64,
          kernel_size: 3,
          stride: 1,
          padding: 1,
          dilation: 1,
        },
        // source が null なのはグラフ入力(画像)を意味する
        inputs: [{ port: 'x', source: null }],
      },
      {
        id: 'relu1',
        spec: { type: 'activation', activation_type: 'relu', dim: 1 },
        inputs: [{ port: 'x', source: { node_id: 'conv1', port: 'y' } }],
      },
      {
        id: 'bn1',
        spec: { type: 'batch_norm', num_features: 64, eps: 1e-5, momentum: 0.5 },
        inputs: [{ port: 'x', source: { node_id: 'relu1', port: 'y' } }],
      },
      {
        id: 'pool1',
        spec: { type: 'indexed_pooling', kernel_size: 2, stride: 2, padding: 0 },
        inputs: [{ port: 'x', source: { node_id: 'bn1', port: 'y' } }],
      },
      {
        id: 'unpool1',
        spec: { type: 'unpooling', kernel_size: 2, stride: 2, padding: 0 },
        // Unpooling だけは入力ポートが 2 つ(x と indices)ある
        inputs: [
          { port: 'x', source: { node_id: 'pool1', port: 'y' } },
          { port: 'indices', source: { node_id: 'pool1', port: 'indices' } },
        ],
      },
      {
        id: 'out_conv',
        spec: {
          type: 'conv2d',
          in_channels: 64,
          out_channels: 3,
          kernel_size: 3,
          stride: 1,
          padding: 1,
          dilation: 1,
        },
        inputs: [{ port: 'x', source: { node_id: 'unpool1', port: 'y' } }],
      },
    ],
    outputs: [{ node_id: 'out_conv', port: 'y' }],
  },
  optimizer: {
    type: 'adam',
    learning_rate: 0.001,
    weight_decay: 0.0,
    beta1: 0.9,
    beta2: 0.999,
    eps: 1e-8,
  },
  loss: { type: 'cross_entropy' },
  epoch: 1,
  batch: 6,
  dataset_path: '/workspaces/apps/backend/ai-engine/TrainingDataset/',
  device: 'cuda:0',
  data_spec: {
    type: 'image',
    input_width: 256,
    input_height: 256,
    image_task_spec: { type: 'segmentation', ignore_index: 255 },
    image_annotation_config: { type: 'pascal_voc', include_difficult: false },
  },
  save_last_every: 0,
  seed: 0,
}

describe('openapi.yaml の StartTrainingRequest', () => {
  it('test_segnet_dag.json を変換すると、契約の形になる', () => {
    const example = startTrainingRequestJsonSchema.parse(JSON.parse(exampleRaw))

    expect(toRustStartTrainingRequest(example)).toEqual({ ok: true, value: expected })
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
