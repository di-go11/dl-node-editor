use crate::pb::capabilities::v1 as pb;
use entities::{Device, DeviceType};

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

impl TryFrom<pb::DeviceInfo> for Device {
    type Error = ConversionError;
    fn try_from(value: pb::DeviceInfo) -> Result<Self, Self::Error> {
        let device_type = pb::DeviceType::try_from(value.device_type)
            .map_err(|_| ConversionError::UnknownDeviceType(value.device_type))?;
        Ok(Device {
            name: value.device_name,
            index: value.device_index,
            device_type: device_type.try_into()?,
        })
    }
}

#[cfg(test)]
mod devicetype_tests {
    use super::*; // 親モジュールでuseした名前を使うために参照. impl自体は取り込まなくても使える

    fn test_try_from(value: pb::DeviceType, expected: Result<DeviceType, ConversionError>) {
        let result = DeviceType::try_from(value);
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

#[cfg(test)]
mod deviceinfo_to_device_tests {
    use super::*;
    fn device_info(device_type: i32) -> pb::DeviceInfo {
        pb::DeviceInfo {
            device_name: "NVIDIA RTX 4070 super".to_string(),
            device_index: 1,
            device_type,
        }
    }

    fn test_try_from(value: pb::DeviceInfo, expected: Result<Device, ConversionError>) {
        let result = Device::try_from(value);
        assert_eq!(result, expected)
    }
    // 正常系
    #[test]
    fn cuda_device_info_converts_to_domain_device() {
        test_try_from(
            device_info(pb::DeviceType::Cuda as i32),
            Ok(Device {
                name: "NVIDIA RTX 4070 super".to_string(),
                index: 1,
                device_type: DeviceType::Cuda,
            }),
        );
    }
    // 異常系
    #[test]
    fn unspecified_device_type_is_rejected() {
        test_try_from(
            device_info(pb::DeviceType::Unspecified as i32),
            Err(ConversionError::UnspecifiedDeviceType),
        );
    }

    #[test]
    fn unknown_device_type_is_rejected() {
        test_try_from(device_info(99), Err(ConversionError::UnknownDeviceType(99)));
    }
}
