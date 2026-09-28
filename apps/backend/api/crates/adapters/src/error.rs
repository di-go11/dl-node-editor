use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConversionError {
    #[error("device type is unspecified")]
    UnspecifiedDeviceType,
}
