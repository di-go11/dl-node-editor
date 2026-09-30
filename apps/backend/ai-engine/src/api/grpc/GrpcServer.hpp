#pragma once

#include <atomic>
#include <memory>
#include <string>
#include <vector>

#include <grpcpp/grpcpp.h>

class GrpcServer
{
public:
    // services: 登録するサービス(Capabilities, Training など)。所有しない。
    GrpcServer(std::string address, std::vector<grpc::Service *> services);

    void run();      // BuildAndStart() して Wait()まで
    void shutdown(); // 別スレッド/シグナルハンドラから呼ぶ

private:
    std::string _address;
    std::vector<grpc::Service *> _services; // 所有しない. 呼び出し側(GrpcApp)が生存を保証
    std::unique_ptr<grpc::Server> _server;  // BuildAndStart()の戻り値

    std::atomic<bool> _started{false}; // _serverへの書き込み(run())と_serverの読み込み(shutdown())が異なるスレッドで発生した際に以上を起こさないようにするためのフラグ
};
