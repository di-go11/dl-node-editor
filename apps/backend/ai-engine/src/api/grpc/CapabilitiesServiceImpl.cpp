#include "api/grpc/CapabilitiesServiceImpl.hpp"

namespace
{
    capabilities::v1::DeviceType toProtoDeviceType(ComputeDeviceType type)
    {
        switch (type)
        {
        case ComputeDeviceType::Cpu:
            return capabilities::v1::DEVICE_TYPE_CPU;
        case ComputeDeviceType::Cuda:
            return capabilities::v1::DEVICE_TYPE_CUDA;
        }
        return capabilities::v1::DEVICE_TYPE_UNSPECIFIED;
    }
}

CapabilitiesServiceImpl::CapabilitiesServiceImpl(ICapabilityProvider &provider)
    : _provider(provider)
{
}

grpc::Status CapabilitiesServiceImpl::GetCapabilities(grpc::ServerContext * /*context*/,
                                                      const google::protobuf::Empty * /*request*/,
                                                      capabilities::v1::CapabilitiesResponse *response)
{
    const CapabilitySnapshot snapshot = _provider.snapshot();

    response->set_cuda_available(snapshot.cudaAvailable);
    for (const DeviceSnapshot &d : snapshot.devices)
    {
        capabilities::v1::DeviceInfo *info = response->add_devices();
        info->set_device_name(d.name);
        info->set_device_index(d.index);
        info->set_device_type(toProtoDeviceType(d.type));
    }

    return grpc::Status::OK;
}
