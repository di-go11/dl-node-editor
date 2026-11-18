-- データセットのメタデータ登録用テーブル
CREATE TABLE IF NOT EXISTS datasets (
    dataset_id TEXT PRIMARY KEY,
    dataset_name TEXT NOT NULL,
    dataset_type TEXT NOT NULL, -- pascal_voc / coco / imagenet
    dataset_path TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME
);