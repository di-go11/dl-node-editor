#include "api/grpc/GrpcServer.hpp"

#include <iostream>
#include <stdexcept>
#include <utility>

#include <unistd.h> // getpid

GrpcServer::GrpcServer(std::string address, std::vector<grpc::Service *> services)
    : _address(std::move(address)), _services(std::move(services))
{
}

void GrpcServer::run()
{
    grpc::ServerBuilder builder;
    builder.AddListeningPort(_address, grpc::InsecureServerCredentials()); // _adressのアドレス&ポートで暗号方式は平文
    for (grpc::Service *service : _services)
    {
        builder.RegisterService(service);
    }

    _server = builder.BuildAndStart();

    if (!_server)
    {
        throw std::runtime_error("GrpcServer: failed to bind " + _address);
    }
    _started.store(true); // ここで _server への代入が完了している。Wait() は
                           // shutdown() が呼ばれるまで戻らないので、その前に立てる。

    // 待ち受けを始めたことを知らせる(これまでは起動しても何も出ず、動いているか分からなかった)。
    // gRPC は Linux では SO_REUSEPORT で同じポートを複数のプロセスが開けるので、
    // 古いプロセスが残っていないかを pgrep -a ai_engine_app と見比べられるよう、PID も出す。
    // std::endl で書き出す(ログをファイルに向けたときも、すぐに出るように)。
    std::cout << "ai-engine: gRPC サーバーを起動しました(" << _address << "、pid " << ::getpid() << ")"
              << std::endl;

    _server->Wait();      // shutdown()が呼ばれるまでそのまま
}

void GrpcServer::shutdown()
{
    if (_started.load() && _server) // _staetedより_serverへの代入を保証しつつ、_serverがnullptrではないとき=シングルスレッドのみが適切に動作する。マルチスレッドを考える場合は別途考える必要がある
    {
        _server->Shutdown();
    }
}