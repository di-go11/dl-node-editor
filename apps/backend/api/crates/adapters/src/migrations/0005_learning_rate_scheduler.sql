-- テーブル生成後このファイルは編集不可. テーブルの整合性が保てなくなるため。
-- 学習率スケジューラの設定(学習の安定化 issue の段階 3b)と、エポックごとの実際の学習率(段階 3c)を保存する。
-- 0005 より前の行は、スケジューラなし(none・warmup なし)、学習率は NULL(記録なし)になる。

-- 学習率スケジューラ。基準の学習率は optimizer の learning_rate 列(スケジューラ側には持たない)
ALTER TABLE training_config ADD COLUMN lr_scheduler_type TEXT NOT NULL DEFAULT 'none'; -- none / poly / cosine / step
ALTER TABLE training_config ADD COLUMN lr_power REAL;          -- poly
ALTER TABLE training_config ADD COLUMN lr_min_lr REAL;         -- cosine
ALTER TABLE training_config ADD COLUMN lr_step_size INTEGER;   -- step(エポック数)
ALTER TABLE training_config ADD COLUMN lr_gamma REAL;          -- step
ALTER TABLE training_config ADD COLUMN lr_update_interval TEXT NOT NULL DEFAULT 'per_batch'; -- per_batch / per_epoch
ALTER TABLE training_config ADD COLUMN lr_warmup_epochs INTEGER NOT NULL DEFAULT 0;

-- エポックの最後のバッチで実際に使った学習率(Optimizer から読んだ値)。0005 より前のエポックは NULL
ALTER TABLE training_epochs ADD COLUMN learning_rate REAL;
