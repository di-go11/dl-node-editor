use std::path::{Path, PathBuf};

use super::error::DatasetError;
use entities::{
    dataset::{DatasetConfig, DatasetId},
    training::config::TrainingConfig,
};

// データセット保存用ポート
pub trait DatasetSaver {
    fn save(
        &self,
        tmp_path: &Path,
        dataset_id: &DatasetId,
    ) -> impl Future<Output = Result<PathBuf, DatasetError>>;
}
// データセットのメタデータを登録用ポート
pub trait DatasetRegister {
    fn register(
        &self,
        dataset_config: &RegisterDatasetInput,
    ) -> impl Future<Output = Result<(), DatasetError>>;
}

pub struct RegisterDatasetInput {
    pub dataset_id: DatasetId,
    pub dataset_name: String,
    pub dataset_type: String,
    pub dataset_path: String,
}

pub trait DatasetCaller {
    fn call(
        &self,
        dataset_path: &str,
        training_config: &mut TrainingConfig,
    ) -> impl Future<Output = Result<(), DatasetError>>;
}

pub trait DatasetReader {
    fn read(&self) -> impl Future<Output = Result<Vec<DatasetConfig>, DatasetError>>;
}
