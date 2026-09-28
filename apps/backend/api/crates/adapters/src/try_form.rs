use entities::{DeviceType, Device, Capabilities};
use std::sync::Arc;

impl TryFrom<pb::DeviceType> for DeviceType {
    type Error = ConverError;
    fn try_from(v: pb::DeviceType) -> Result<Self, Self::Error> {
        match v {
            pb::DeviceType::Cpu => Ok(DeviceType::Cpu),
            pb::DeviceType::Cuda => Ok(DeviceType::Cuda),
            pb::DeviceType::Unspecified => Err(ConverError::UnspecifiedDeviceType),
        }
    }
}