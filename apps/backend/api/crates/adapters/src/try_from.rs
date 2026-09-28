use crate::pb::capabilities::v1 as pb;
use entities::DeviceType;

use crate::ConversionError;

impl TryFrom<pb::DeviceType> for DeviceType {
    type Error = ConversionError;
    fn try_from(v: pb::DeviceType) -> Result<Self, Self::Error> {
        match v {
            pb::DeviceType::Cpu => Ok(DeviceType::Cpu),
            pb::DeviceType::Cuda => Ok(DeviceType::Cuda),
            pb::DeviceType::Unspecified => Err(ConversionError::UnspecifiedDeviceType),
        }
    }
}
