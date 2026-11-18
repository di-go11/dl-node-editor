use entities::dataset::DatasetConfig;

use super::error::DatasetError;

use super::ports::DatasetReader;
pub struct ReadDatasetsSummary<R> {
    reader: R,
}

impl<R: DatasetReader> ReadDatasetsSummary<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }
    pub async fn execute(&self) -> Result<Vec<DatasetConfig>, DatasetError> {
        self.reader.read().await
    }
}
