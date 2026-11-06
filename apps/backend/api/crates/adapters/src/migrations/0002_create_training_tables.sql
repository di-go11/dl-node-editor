-- テーブル生成後このファイルは編集不可. テーブルの整合性が保てなくなるため。
-- model テーブルに、モデル構造(ModelGraph)の JSON を保存する列を追加する。
-- 0001 適用済みの既存の行には構造がないため NULL を許す。NULL のモデルは再開を許可しない。
-- JSON の形は adapters/src/model/graph_json.rs の Stored* 構造体で決まる(HTTP の DTO とは独立)。
ALTER TABLE model ADD COLUMN model_graph TEXT;
