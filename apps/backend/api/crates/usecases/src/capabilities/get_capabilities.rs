use entities::capabilities::Capabilities;

use super::{CapabilityProvider, ProviderError};

pub struct GetCapabilities<P: CapabilityProvider> {
    provider: P,
}

impl<P: CapabilityProvider> GetCapabilities<P> {
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    pub async fn execute(&self) -> Result<Capabilities, ProviderError> {
        self.provider.fetch().await
    }
}

#[cfg(test)]
mod tests {
    use entities::capabilities::{Device, DeviceType};

    use super::*;

    // テスト用の偽物の Provider。C++ を起動せずに、決めた結果を返す
    struct FakeProvider {
        result: Result<Capabilities, ProviderError>,
    }

    impl CapabilityProvider for FakeProvider {
        async fn fetch(&self) -> Result<Capabilities, ProviderError> {
            self.result.clone()
        }
    }

    fn cpu_only() -> Capabilities {
        Capabilities::new(vec![Device {
            name: "cpu".to_string(),
            index: 0,
            device_type: DeviceType::Cpu,
        }])
        .unwrap()
    }

    #[tokio::test]
    async fn returns_capabilities_from_provider() {
        let usecase = GetCapabilities::new(FakeProvider {
            result: Ok(cpu_only()),
        });
        assert_eq!(usecase.execute().await, Ok(cpu_only()));
    }

    #[tokio::test]
    async fn returns_error_when_provider_is_unavailable() {
        let error = ProviderError::Unavailable("connection refused".to_string());
        let usecase = GetCapabilities::new(FakeProvider {
            result: Err(error.clone()),
        });
        assert_eq!(usecase.execute().await, Err(error));
    }
}
