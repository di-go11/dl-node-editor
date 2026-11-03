use entities::training::ModelId;
use usecases::training::ModelIdGenerator;
use uuid::Uuid;

pub struct UuidModelGenerator;

impl ModelIdGenerator for UuidModelGenerator {
    fn generate(&self) -> ModelId {
        ModelId::new(Uuid::now_v7().to_string()).expect("UUID must not be empty")
    }
}
