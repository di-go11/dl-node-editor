use entities::dataset::DatasetConfig;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DatasetSummariesDto {
    pub datasets: Vec<DatasetConfigDto>,
}

impl From<&[DatasetConfig]> for DatasetSummariesDto {
    fn from(list: &[DatasetConfig]) -> Self {
        Self {
            datasets: list.iter().map(DatasetConfigDto::from).collect(), // 参照スライスをイテレータで取り出してVecにしてDatasetConfigDtoに収納して返す処理
        }
    }
}
#[derive(Debug, Serialize)]
pub struct DatasetConfigDto {
    pub dataset_id: String,
    pub dataset_name: String,
    pub dataset_type: String,
    pub created_at: String,
}

impl From<&DatasetConfig> for DatasetConfigDto {
    fn from(value: &DatasetConfig) -> Self {
        Self {
            dataset_id: value.dataset_id.as_str().to_string(),
            dataset_name: value.dataset_name.clone(),
            dataset_type: value.dataset_type.clone(),
            created_at: value.created_at.clone(),
        }
    }
}

// アップロードした zip が、指定した形式のファイル構成になっていないときの 422 の本文
#[derive(Debug, Serialize)]
pub struct DatasetLayoutMismatchDto {
    // 指定された形式(pascal_voc / original)
    pub format: String,
    // 足りないファイル・ディレクトリ(データセットのルートからの相対パス。ディレクトリは末尾に /)
    pub missing: Vec<String>,
}
