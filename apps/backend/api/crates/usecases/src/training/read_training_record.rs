use entities::training::ModelId;

use crate::training::RepositoryError;

pub trait TrainingRecordReader {
    fn find_model_id_by_name(
        &self,
        model_name: &str,
    ) -> impl Future<Output = Result<Option<ModelId>, RepositoryError>> + Send;
}
