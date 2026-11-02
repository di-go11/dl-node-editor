-- テーブル生成後このファイルは編集不可. テーブルの整合性が保てなくなるため。
-- 再開をまたいで1つの学習を表す trainings を追加し、model_name を training_runs から移す。
CREATE TABLE trainings (
    training_id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_trainings_model_name ON trainings(model_name);

-- 既存の実行は、それぞれ再開なしの1つの学習として移行する。
INSERT INTO trainings (training_id, model_name, created_at)
SELECT job_id, model_name, started_at FROM training_runs;

-- SQLite の ALTER TABLE では外部キー付きの NOT NULL 列を追加できないため、テーブルを作り直す。
-- 子テーブルの外部キー検査は、親の行を戻し終わるコミット時まで遅らせる。
-- RENAME では遅延中の違反が解消されないため、同じ名前で作り直して INSERT で戻す。
PRAGMA defer_foreign_keys = ON;

CREATE TABLE training_runs_backup AS
SELECT job_id, status, failure_reason, started_at, finished_at FROM training_runs;

DROP TABLE training_runs;

CREATE TABLE training_runs (
    job_id TEXT PRIMARY KEY,
    training_id TEXT NOT NULL REFERENCES trainings(training_id),
    status TEXT NOT NULL,
    failure_reason TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

INSERT INTO training_runs (job_id, training_id, status, failure_reason, started_at, finished_at)
SELECT job_id, job_id, status, failure_reason, started_at, finished_at FROM training_runs_backup;

DROP TABLE training_runs_backup;

CREATE INDEX idx_training_runs_training_id ON training_runs(training_id);