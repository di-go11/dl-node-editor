use thiserror::Error;

#[derive(Debug, PartialEq, Eq, Error)]
pub enum ConversionError {
    #[error("device type is unspecified")]
    UnspecifiedDeviceType,
}
