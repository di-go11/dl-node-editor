-- テーブル生成後このファイルは編集不可. テーブルの整合性が保てなくなるため。
CREATE TABLE training_runs (
    job_id TEXT PRIMARY KEY,
    training_id TEXT NOT NULL, --再開時に同じid
    model_name TEXT NOT NULL,
    status TEXT NOT NULL,
    failure_reason TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX idx_training_runs_model_name ON training_runs(training_id);

CREATE TABLE training_config (
    job_id TEXT PRIMARY KEY REFERENCES training_runs(job_id),

    epochs INTEGER NOT NULL, -- 学習時の全エポック数
    batch INTEGER NOT NULL, -- 学習時のバッチサイズ
    device TEXT NOT NULL, -- 学習時のデバイス（cpu / cuda:0 / cuda:1 ...）
    dataset_path TEXT NOT NULL,
    save_last_every INTEGER NOT NULL,
    resume_from TEXT,
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
    epoch_elapsed_ms INTEGER NOT NULL,
    total_elapsed_ms INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (job_id, epoch)
);

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