use std::path::{Path, PathBuf};

use super::error::DatasetError;
use entities::dataset::{DatasetConfig, DatasetId};

// データセット保存用ポート
pub trait DatasetSaver {
    fn save(
        &self,
        tmp_path: &Path,
        dataset_id: &DatasetId,
    ) -> impl Future<Output = Result<PathBuf, DatasetError>> + Send;
}
// データセットのメタデータを登録用ポート
pub trait DatasetRegister {
    fn register(
        &self,
        dataset_config: &RegisterDatasetInput,
    ) -> impl Future<Output = Result<(), DatasetError>> + Send;
}

pub struct RegisterDatasetInput {
    pub dataset_id: DatasetId,
    pub dataset_name: String,
    pub dataset_type: String,
    pub dataset_path: String,
}

// 登録済みデータセットを ID で 1 件引くポート(学習開始時に、クライアントが選んだ ID からパスを決めるために使う)。
// 見つからないのは異常ではないので Ok(None) で返し、DB の失敗だけを Err にする。
pub trait DatasetFinder {
    fn find(
        &self,
        dataset_id: &DatasetId,
    ) -> impl Future<Output = Result<Option<DatasetConfig>, DatasetError>> + Send;
}

// メタデータ呼び出し用ポート
pub trait DatasetReader {
    fn read(&self) -> impl Future<Output = Result<Vec<DatasetConfig>, DatasetError>> + Send;
}
