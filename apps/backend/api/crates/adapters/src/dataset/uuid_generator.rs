use entities::dataset::DatasetId;
use usecases::dataset::dataset_id_generator::DatasetIdGenerator;
use uuid::Uuid;

pub struct UuidDatasetIdGenerator;

impl DatasetIdGenerator for UuidDatasetIdGenerator {
    fn generate_id(&self) -> DatasetId {
        DatasetId::new(Uuid::now_v7().to_string()).expect("UUID must not be empty")
    }
}
