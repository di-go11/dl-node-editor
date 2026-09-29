use thiserror::Error;

#[derive(Debug, PartialEq, Eq, Error)]
pub enum ConversionError {
    #[error("device type is unspecified")]
    UnspecifiedDeviceType,
    #[error("unknown device type: {0}")]
    UnknownDeviceType(i32),
    #[error(transparent)]
    InvalidCapabilities(#[from] entities::CapabilitiesError),
}
