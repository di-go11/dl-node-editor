use entities::dataset::DatasetId;
pub trait DatasetIdGenerator {
    fn generate_id(&self) -> DatasetId;
}
