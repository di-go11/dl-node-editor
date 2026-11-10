use entities::capabilities::Capabilities;
use tonic::transport::Channel;
use usecases::capabilities::{CapabilityProvider, ProviderError};

use crate::pb::capabilities::v1::capabilities_client::CapabilitiesClient;

pub struct GrpcCapabilityProvider {
    client: CapabilitiesClient<Channel>,
}

impl GrpcCapabilityProvider {
    pub fn new(channel: Channel) -> Self {
        Self {
            client: CapabilitiesClient::new(channel),
        }
    }
}

impl CapabilityProvider for GrpcCapabilityProvider {
    async fn fetch(&self) -> Result<Capabilities, ProviderError> {
        let response = self
            .client
            .clone()
            .get_capabilities(())
            .await
            .map_err(|status| ProviderError::Unavailable(status.to_string()))?
            .into_inner();
        Capabilities::try_from(response).map_err(|e| ProviderError::InvalidData(e.to_string()))
    }
}
