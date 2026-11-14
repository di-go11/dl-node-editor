use uuid::Uuid;
pub fn generate_uuid() -> String {
    Uuid::now_v7().to_string()
}
