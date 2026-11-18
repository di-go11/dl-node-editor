import type { DatasetSummary } from '../../entity/dataset/dataset'

import type { ApiResult } from './api-result'

/** データセットのアップロードで送る内容(契約の POST /datasets/upload の multipart) */
export type DatasetUpload = {
  /** データセットの zip */
  readonly file: Blob
  /** zip のファイル名(サーバーに送る multipart のファイル名) */
  readonly fileName: string
  /** 一覧に表示する名前 */
  readonly name: string
  /** データセットの形式(pascal_voc など) */
  readonly type: string
}

/**
 * 登録済みデータセットの一覧(契約の GET /datasets)と、アップロード(POST /datasets/upload)。
 *
 * 一覧は学習設定画面のデータセットの選択肢と、データセット一覧画面に使う。選んだデータセットの ID は
 * 学習設定(TrainingSettings.datasetId)に入れ、学習開始のリクエストで送る。
 */
export type DatasetApi = {
  list(): Promise<ApiResult<readonly DatasetSummary[]>>
  /** zip を送って登録する。サーバーが解凍・登録を終えてから結果が返る(大きい zip は時間がかかる) */
  upload(upload: DatasetUpload): Promise<ApiResult<null>>
}
