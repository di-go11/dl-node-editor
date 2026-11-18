/**
 * 登録済みデータセットの一覧の 1 件。学習設定画面でデータセットを選ぶのに使う。
 *
 * サーバー上のパスは持たない。学習開始では datasetId だけを送り、パスはサーバーが ID から決める。
 * HTTP の JSON 表記(dataset_id など)との対応は infrastructure/http に閉じ込める。
 */
export type DatasetSummary = {
  readonly datasetId: string
  /** アップロード時に付けた名前 */
  readonly name: string
  /** データセットの形式(pascal_voc など。アップロード時に指定した文字列のまま) */
  readonly type: string
  /** 登録した日時(UTC。サーバーの文字列のまま) */
  readonly createdAt: string
}

/** アップロードできるファイルか(サーバーは zip だけを解凍できる) */
export function isZipFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.zip')
}

/** zip のファイル名から、データセットの名前の初期値を作る(拡張子を外す) */
export function datasetNameFromFileName(fileName: string): string {
  return isZipFileName(fileName) ? fileName.slice(0, -'.zip'.length) : fileName
}
