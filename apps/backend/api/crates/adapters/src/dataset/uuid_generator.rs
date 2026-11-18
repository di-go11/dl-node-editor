use entities::dataset::DatasetId;
use usecases::dataset::dataset_id_generator::DatasetIdGenerator;

use crate::utils::uuid_generator::generate_uuid;

// データセットIDを UUID v7 で発行する(学習側の UuidModelGenerator と同じ方式)
pub struct UuidDatasetIdGenerator;

impl DatasetIdGenerator for UuidDatasetIdGenerator {
    fn generate_id(&self) -> DatasetId {
        DatasetId::new(generate_uuid()).expect("UUID must not be empty")
    }
}
