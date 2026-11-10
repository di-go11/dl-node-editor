use std::collections::HashSet;
use thiserror::Error;

use super::{Device, DeviceType};

#[derive(Debug, PartialEq, Eq, Error)]
pub enum CapabilitiesError {
    #[error("Capabilities must contain at least one CPU device")]
    MissingCpu,
    #[error("duplicate device: {device_type:?} index {index}")]
    DuplicateDevice { device_type: DeviceType, index: u32 },
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Capabilities {
    devices: Vec<Device>, // pub を外す:new() を通さないと作れない
}

impl Capabilities {
    pub fn new(devices: Vec<Device>) -> Result<Self, CapabilitiesError> {
        if !devices.iter().any(|d| d.device_type == DeviceType::Cpu) {
            return Err(CapabilitiesError::MissingCpu);
        }
        let mut seen = HashSet::new();
        for d in &devices {
            if !seen.insert((d.device_type, d.index)) {
                return Err(CapabilitiesError::DuplicateDevice {
                    device_type: d.device_type,
                    index: d.index,
                });
            }
        }
        Ok(Self { devices })
    }

    pub fn devices(&self) -> &[Device] {
        &self.devices
    }

    pub fn cuda_available(&self) -> bool {
        self.devices
            .iter()
            .any(|d| d.device_type == DeviceType::Cuda)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(device_type: DeviceType, index: u32) -> Device {
        Device {
            name: "test-device".to_string(),
            index,
            device_type,
        }
    }

    // 正常系
    #[test]
    fn cpu_only_is_valid_and_cuda_is_unavailable() {
        let caps = Capabilities::new(vec![device(DeviceType::Cpu, 0)]).unwrap();
        assert_eq!(caps.devices().len(), 1);
        assert!(!caps.cuda_available());
    }

    #[test]
    fn cpu_and_cuda_is_valid_and_cuda_is_available() {
        let caps = Capabilities::new(vec![
            device(DeviceType::Cpu, 0),
            device(DeviceType::Cuda, 0),
            device(DeviceType::Cuda, 1),
        ])
        .unwrap();
        assert_eq!(caps.devices().len(), 3);
        assert!(caps.cuda_available());
    }

    #[test]
    fn same_index_with_different_device_type_is_allowed() {
        // cpu:0 と cuda:0 は種類が違うので重複ではない
        let result = Capabilities::new(vec![
            device(DeviceType::Cpu, 0),
            device(DeviceType::Cuda, 0),
        ]);
        assert!(result.is_ok());
    }

    // 異常系
    #[test]
    fn empty_devices_is_rejected() {
        assert_eq!(
            Capabilities::new(vec![]),
            Err(CapabilitiesError::MissingCpu)
        );
    }

    #[test]
    fn cuda_only_is_rejected() {
        assert_eq!(
            Capabilities::new(vec![device(DeviceType::Cuda, 0)]),
            Err(CapabilitiesError::MissingCpu)
        );
    }

    #[test]
    fn duplicate_device_is_rejected() {
        assert_eq!(
            Capabilities::new(vec![
                device(DeviceType::Cpu, 0),
                device(DeviceType::Cuda, 0),
                device(DeviceType::Cuda, 0),
            ]),
            Err(CapabilitiesError::DuplicateDevice {
                device_type: DeviceType::Cuda,
                index: 0,
            })
        );
    }
}
