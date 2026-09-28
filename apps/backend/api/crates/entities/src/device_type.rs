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
    use std::println;

    use super::*;

    #[test]
    fn cuda_available_can_be_called_repeatedly() {
        let caps = Capabilities { devices: vec![] };
        caps.cuda_available();
        caps.cuda_available();
        println!("{}", caps.devices.len());
    }
}
