use entities::capabilities::{
    Capabilities, Device,
    DeviceType::{Cpu, Cuda},
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CapabilitiesDto {
    pub devices: Vec<DeviceDto>,
}

impl From<Capabilities> for CapabilitiesDto {
    fn from(capabilities: Capabilities) -> Self {
        CapabilitiesDto {
            devices: capabilities.devices().iter().map(DeviceDto::from).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DeviceDto {
    pub id: String,
    pub name: String,
}

impl From<&Device> for DeviceDto {
    fn from(device: &Device) -> Self {
        let id = match device.device_type {
            Cpu => "cpu".to_string(),
            Cuda => format!("cuda:{}", device.index),
        };
        DeviceDto {
            id,
            name: device.name.clone(),
        }
    }
}
