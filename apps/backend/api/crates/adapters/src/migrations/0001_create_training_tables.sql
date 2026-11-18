-- テーブル生成後このファイルは編集不可. テーブルの整合性が保てなくなるため。
CREATE TABLE model (
    model_id TEXT PRIMARY KEY,
    model_name TEXT NOT NULL UNIQUE,
    -- TODO: ModelGraphのJSON化を実装するまで保存しない
    -- model_graph TEXT NOT NULL, --JSONのメタデータ
    created_at DATETIME NOT NULL
);




-- 一回の学習でINSERTとUPDATEの2回のトランザクションが発生する。一応同時には発生しないため一旦このまま。
CREATE TABLE training_runs (
    job_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES model(model_id),
    status TEXT NOT NULL,
    failure_reason TEXT,
    started_at TEXT NOT NULL, --学習開始時刻。
    finished_at TEXT -- 学習終了時刻。終了を記録できなければNULL
);

CREATE INDEX idx_training_runs_model_id ON training_runs(model_id);

CREATE TABLE training_config (
    job_id TEXT PRIMARY KEY REFERENCES training_runs(job_id),

    epochs INTEGER NOT NULL, -- 学習時の指定エポック数
    batch INTEGER NOT NULL, -- 学習時の指定バッチサイズ
    device TEXT NOT NULL, -- 学習時のデバイス（cpu / cuda:0 / cuda:1 ...）
    dataset_path TEXT NOT NULL, -- データセットのパス
    save_last_every INTEGER NOT NULL, -- 学習パラメータを保存する周期
    resume_from TEXT, --学習再開時に参照される.ptファイルパス
    seed INTEGER,

    -- optimizer
    optimizer_type    TEXT NOT NULL,     -- adam / adam_w / sgd
    learning_rate     REAL NOT NULL,
    weight_decay      REAL NOT NULL,
    beta1             REAL,              -- adam, adam_w
    beta2             REAL,              -- adam, adam_w
    eps               REAL,              -- adam
    momentum          REAL,              -- sgd
    nesterov          INTEGER,           -- sgd（0 / 1）

    -- loss
    loss_type         TEXT NOT NULL,     -- cross_entropy / mse / dice / focal / combo / boundary
    loss_gamma        REAL,              -- focal
    loss_alpha        REAL,              -- focal, combo

    -- データ
    data_type         TEXT NOT NULL,     -- image
    input_width       INTEGER NOT NULL,
    input_height      INTEGER NOT NULL,
    task_type         TEXT NOT NULL,     -- segmentation / classification
    ignore_index      INTEGER,           -- segmentation
    annotation_type   TEXT NOT NULL,     -- pascal_voc
    include_difficult INTEGER           -- pascal_voc（0 / 1）
);

CREATE TABLE training_epochs (
    job_id TEXT NOT NULL REFERENCES training_runs(job_id),
    epoch INTEGER NOT NULL, -- プロセス終了したエポックナンバー
    train_loss REAL,
    val_loss REAL,
    epoch_elapsed_ms INTEGER NOT NULL, --1エポックごとの経過時間(ms)
    PRIMARY KEY (job_id, epoch)
);

-- タスクごとのメトリクス
CREATE TABLE segmentation_epoch_metrics (
    job_id TEXT NOT NULL,
    epoch INTEGER NOT NULL, -- プロセス終了したエポックナンバー
    pixel_accuracy REAL,
    miou REAL,
    fw_iou REAL,
    mean_class_accuracy REAL,
    PRIMARY KEY (job_id, epoch),
    FOREIGN KEY (job_id, epoch) REFERENCES training_epochs(job_id, epoch)
);
CREATE TABLE segmentation_class_metrics (
    job_id      TEXT NOT NULL,
    epoch       INTEGER NOT NULL,
    class_index INTEGER NOT NULL, -- 後々,labelmapからクラス名を取得もしくは,labelmapを呼び込みそれを保存にする
    iou         REAL,
    PRIMARY KEY (job_id, epoch, class_index),
    FOREIGN KEY (job_id, epoch) REFERENCES training_epochs(job_id, epoch)
);

CREATE TABLE classification_epoch_metrics (
    job_id   TEXT NOT NULL,
    epoch    INTEGER NOT NULL,
    accuracy REAL,
    macro_f1 REAL,
    PRIMARY KEY (job_id, epoch),
    FOREIGN KEY (job_id, epoch) REFERENCES training_epochs(job_id, epoch)
);

CREATE TABLE classification_class_metrics (
    job_id      TEXT NOT NULL,
    epoch       INTEGER NOT NULL,
    class_index INTEGER NOT NULL, -- こっちも同じ修正が必要
    accuracy    REAL,
    PRIMARY KEY (job_id, epoch, class_index),
    FOREIGN KEY (job_id, epoch) REFERENCES training_epochs(job_id, epoch)
);