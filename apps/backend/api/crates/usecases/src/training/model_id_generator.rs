use entities::training::ModelId;
pub trait ModelIdGenerator {
    fn generate(&self) -> ModelId;
}
