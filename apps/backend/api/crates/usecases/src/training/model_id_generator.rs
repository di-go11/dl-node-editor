use entities::model::ModelId;
pub trait ModelIdGenerator {
    fn generate(&self) -> ModelId;
}
