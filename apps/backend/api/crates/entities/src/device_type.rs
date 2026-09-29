#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum DeviceType {
    Cpu,
    Cuda,
}

pub struct Device {
    pub name: String,
    pub index: u32,
    pub device_type: DeviceType,
}

pub struct Capabilities {
    pub devices: Vec<Device>,
}

impl Capabilities {
    pub fn cuda_available(&self) -> bool {
        self.devices
            .iter()
            .any(|d| matches!(d.device_type, DeviceType::Cuda))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(device_type: DeviceType) -> Device {
        Device {
            name: "test-device".to_string(),
            index: 0,
            device_type,
        }
    }

    #[test]
    fn cuda_available_is_false_when_no_devices() {
        let caps = Capabilities { devices: vec![] };
        assert_eq!(caps.cuda_available(), false);
    }

    #[test]
    fn cuda_available_is_false_when_only_cpu_devices() {
        let caps = Capabilities {
            devices: vec![device(DeviceType::Cpu)],
        };
        assert_eq!(caps.cuda_available(), false);
    }

    #[test]
    fn cuda_available_is_true_when_cuda_device_present() {
        let caps = Capabilities {
            devices: vec![device(DeviceType::Cpu), device(DeviceType::Cuda)],
        };
        assert_eq!(caps.cuda_available(), true);
    }
}
