-- テーブル生成後このファイルは編集不可. テーブルの整合性が保てなくなるため。
-- セグメンテーションで「無視する色」(マスク画像でこの色の画素を ignore_index に変換する)を保存する列を追加する。
-- 3 列とも NULL なら無視する色の指定なし(labelmap にない色はエラー)。0004 より前の行もすべて NULL になる。
ALTER TABLE training_config ADD COLUMN ignore_color_r INTEGER;
ALTER TABLE training_config ADD COLUMN ignore_color_g INTEGER;
ALTER TABLE training_config ADD COLUMN ignore_color_b INTEGER;
