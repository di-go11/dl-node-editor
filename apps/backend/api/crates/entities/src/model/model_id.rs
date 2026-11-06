use thiserror::Error;

#[derive(Debug, PartialEq, Eq, Error)]
pub enum ModelIdError {
    #[error("model id must not be empty")]
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ModelId(String);

impl ModelId {
    pub fn new(value: impl Into<String>) -> Result<Self, ModelIdError> {
        let value = value.into();
        if value.is_empty() {
            return Err(ModelIdError::Empty);
        }
        Ok(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
