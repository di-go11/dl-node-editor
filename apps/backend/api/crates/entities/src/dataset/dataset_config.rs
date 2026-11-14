use thiserror::Error;

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct DatasetConfig {
    pub dataset_id: DatasetId,
    pub dataset_name: String,
    pub dataset_type: String, // pascal_voc / coco / imagenet
    pub dataset_path: String,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct DatasetId(String);

#[derive(Debug, PartialEq, Eq, Error)]
pub enum DatasetIdError {
    #[error("dataset id must not be empty")]
    Empty,
}

impl DatasetId {
    pub fn new(value: impl Into<String>) -> Result<Self, DatasetIdError> {
        let value = value.into();
        if value.is_empty() {
            return Err(DatasetIdError::Empty); // 不変条件: 空の ID は存在しない
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0 // 中身を「借用」として貸すだけで、コピーしない
    }
}
