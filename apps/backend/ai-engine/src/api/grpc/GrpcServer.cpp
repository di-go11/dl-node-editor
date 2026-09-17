#include "api/grpc/GrpcServer.hpp"

GrpcServer::GrpcServer(std::string address, grpc::Service &service) : _address(address), _service(service)
{
}

void GrpcServer::run()
{
    grpc::ServerBuilder builder;
    builder.AddListeningPort(_address, grpc::InsecureServerCredentials()); // _adressのアドレス&ポートで暗号方式は平文
    builder.RegisterService(&_service);

    _server = builder.BuildAndStart();

    if (!_server)
    {
        throw std::runtime_error("GrpcServer: failed to bind " + _address);
    }
    _started.store(true); // ここで _server への代入が完了している。Wait() は
                           // shutdown() が呼ばれるまで戻らないので、その前に立てる。
    _server->Wait();      // shutdown()が呼ばれるまでそのまま
}

void GrpcServer::shutdown()
{
    if (_started.load() && _server) // _staetedより_serverへの代入を保証しつつ、_serverがnullptrではないとき=シングルスレッドのみが適切に動作する。マルチスレッドを考える場合は別途考える必要がある
    {
        _server->Shutdown();
    }
}