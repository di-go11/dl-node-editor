use thiserror::Error;
use usecases::dataset::error::DatasetError;
use zip::result::ZipError;

// ZipError / io::Error が Clone・PartialEq を実装していないため、それらは derive しない
#[derive(Debug, Error)]
pub enum FileError {
    // zip形式のファイルの解凍に失敗した際のエラー
    #[error("Failed to unzip file: {0}")]
    UnzipFailed(#[from] ZipError),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Archive contains unsafe path: {0}")]
    UnsafePath(String),
    #[error("Archive exceeds size limit")]
    TooLarge,
}

impl From<FileError> for DatasetError {
    fn from(e: FileError) -> Self {
        DatasetError::SaveFailed(e.to_string())
    }
}
