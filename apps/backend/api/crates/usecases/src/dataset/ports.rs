use std::path::{Path, PathBuf};

use super::error::DatasetError;
use entities::dataset::{DatasetConfig, DatasetId, RequiredEntry};

// データセット保存用ポート
pub trait DatasetSaver {
    fn save(
        &self,
        tmp_path: &Path,
        dataset_id: &DatasetId,
    ) -> impl Future<Output = Result<PathBuf, DatasetError>> + Send;
    // save で置いたデータセットを消す(形式が合わず登録しないときに使う)
    fn discard(&self, dataset_path: &Path)
    -> impl Future<Output = Result<(), DatasetError>> + Send;
}

// 保存したデータセットのファイル構成を確かめるポート
pub trait DatasetLayoutChecker {
    // required のうち、dataset_path の下にないもの(種類が違うものを含む)を返す。すべてあれば空
    fn find_missing(
        &self,
        dataset_path: &Path,
        required: &[RequiredEntry],
    ) -> impl Future<Output = Result<Vec<RequiredEntry>, DatasetError>> + Send;
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
