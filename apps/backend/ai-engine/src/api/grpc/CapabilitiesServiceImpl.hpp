#pragma once

#include "capabilities.grpc.pb.h"

#include "training/application/interfaces/ICapabilityProvider.hpp"

// gRPC inbound adapter。capabilities::v1::Capabilities::Service を実装する。
// 生成コード(capabilities.pb.h / capabilities.grpc.pb.h)に触れてよいのはこの層だけ。
// ICapabilityProvider 経由で capability を取得し、protobuf のメッセージに詰め替える。
class CapabilitiesServiceImpl final : public capabilities::v1::Capabilities::Service
{
public:
    explicit CapabilitiesServiceImpl(ICapabilityProvider &provider);

    grpc::Status GetCapabilities(grpc::ServerContext *context,
                                 const google::protobuf::Empty *request,
                                 capabilities::v1::CapabilitiesResponse *response) override;

private:
    ICapabilityProvider &_provider;
};
