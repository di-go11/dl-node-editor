#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy)]
pub enum DeviceType {
    Cpu,
    Cuda,
}
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Device {
    pub name: String,
    pub index: u32,
    pub device_type: DeviceType,
}
