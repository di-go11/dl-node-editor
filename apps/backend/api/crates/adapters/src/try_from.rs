use crate::pb::capabilities::v1 as pb;
use entities::DeviceType;
use tonic::Code::Ok;

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

impl TryFrom<pb::DeviceInfo> for DeviceType {
    type Error = ConversionError;
    fn try_from(value: pb::DeviceInfo) -> Result<Self, Self::Error> {
        Ok(entities::Device {
            name: value.device_name,
            index: value.device_index,
            device_type: super::DeviceType::try_from(value.device_type)?.try_into()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_try_from(v: pb::DeviceType, expected: Result<DeviceType, ConversionError>) {
        let result = DeviceType::try_from(v);
        assert_eq!(result, expected);
    }

    #[test]
    fn cpu_converts_to_domain_cpu() {
        test_try_from(pb::DeviceType::Cpu, Ok(DeviceType::Cpu));
    }

    #[test]
    fn cuda_converts_to_domain_cuda() {
        test_try_from(pb::DeviceType::Cuda, Ok(DeviceType::Cuda));
    }

    #[test]
    fn unspecified_is_rejected() {
        test_try_from(
            pb::DeviceType::Unspecified,
            Err(ConversionError::UnspecifiedDeviceType),
        );
    }
}
