#include "api/grpc/GrpcApp.hpp"

#include "api/grpc/CapabilitiesServiceImpl.hpp"
#include "api/grpc/GrpcServer.hpp"
#include "training/infrastructure/torchFunc/CudaCapabilityProvider.hpp"

void runGrpcServer()
{
    CudaCapabilityProvider provider;
    CapabilitiesServiceImpl capabilitiesService(provider);

    GrpcServer server("0.0.0.0:50051", capabilitiesService);
    server.run();
}
