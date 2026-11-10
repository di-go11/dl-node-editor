import { createNodeCatalog } from '../catalog'
import type { NodeTypeDef } from '../node-type'

import { activationType } from './activation'
import { addType } from './add'
import { batchNormType } from './batch-norm'
import { concatType } from './concat'
import { conv2dType } from './conv2d'
import { graphInputType, graphOutputType } from './graph-io'
import { indexedPoolingType } from './indexed-pooling'
import { linearType } from './linear'
import { pooling2dType } from './pooling2d'
import { unpoolingType } from './unpooling'
import { upsampleType } from './upsample'

export * from './activation'
export * from './add'
export * from './batch-norm'
export * from './concat'
export * from './conv2d'
export * from './graph-io'
export * from './indexed-pooling'
export * from './linear'
export * from './pooling2d'
export * from './unpooling'
export * from './upsample'

/**
 * MVP の既定カタログ。
 *
 * **ノードを 1 種類増やすときは、このファイルに import と 1 行を足すだけでよい。**
 * サイドバー、プロパティパネル、検証はこの配列を読んで動く汎用コードなので、
 * ほかのどこも触らずに済む(開放閉鎖原則)。
 *
 * NodePorts.hpp で「これから追加する層」となっているもの(ConvTranspose2D、
 * Flatten、Transformer 系など)も、proto に *Spec が追加されて NODE_KINDS が
 * 増えたあとは、同じ手順で足せる。
 *
 * 並び順はサイドバーでの表示順の基準になる。カテゴリでまとめられるので
 * ここではカテゴリごとにかためて並べている。
 */
export const DEFAULT_NODE_TYPES: readonly NodeTypeDef[] = [
  conv2dType,
  pooling2dType,
  indexedPoolingType,
  batchNormType,
  activationType,
  linearType,
  upsampleType,
  unpoolingType,
  addType,
  concatType,
  graphInputType,
  graphOutputType,
]

export const defaultNodeCatalog = createNodeCatalog(DEFAULT_NODE_TYPES)
