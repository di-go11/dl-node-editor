use crate::dataset::{
    dataset_id_generator::DatasetIdGenerator,
    error::DatasetError,
    ports::{DatasetRegister, DatasetSaver, RegisterDatasetInput},
};

pub struct UploadDataset<G, S, R>
where
    G: DatasetIdGenerator,
    S: DatasetSaver,
    R: DatasetRegister,
{
    saver: S,
    register: R,
    id_generator: G,
}

impl<G: DatasetIdGenerator, S: DatasetSaver, R: DatasetRegister> UploadDataset<G, S, R> {
    pub fn new(id_generator: G, saver: S, register: R) -> Self {
        Self {
            id_generator,
            saver,
            register,
        }
    }
    pub async fn execute(
        &self,
        zip_path: &Path,
        dataset_name: String,
        dataset_type: String,
    ) -> Result<(), DatasetError> {
        let dataset_id = self.id_generator.generate_id();
        let dataset_path = self
            .saver
            .save(zip_path, &dataset_id)
            .await
            .map_err(|e| DatasetError::SaveFailed(e.to_string()))?;

        let dataset_config: RegisterDatasetInput = RegisterDatasetInput {
            dataset_id,
            dataset_name,
            dataset_type,
            dataset_path: dataset_path.to_string_lossy().to_string(),
        };

        self.register
            .register(&dataset_config)
            .await
            .map_err(|e| DatasetError::RegisterFailed(e.to_string()))?;
        Ok(())
    }
}
