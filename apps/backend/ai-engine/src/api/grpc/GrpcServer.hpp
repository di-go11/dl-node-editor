#include <string>

#include <grpcpp/grpcpp.h>

class GrpcServer
{
public:
    GrpcServer(std::string address, grpc::Service &service);

    void run();      // BuildAndStart() して Wait()まで
    void shutdown(); // 別スレッド/シグナルハンドラから呼ぶ

private:
    std::string _address;
    grpc::Service &_service;               // 所有しない. 呼び出し側(main.cpp)が生存を保証
    std::unique_ptr<grpc::Server> _server; // BuildAndStart()の戻り値

    std::atomic<bool> _started{false}; // _serverへの書き込み(run())と_serverの読み込み(shutdown())が異なるスレッドで発生した際に以上を起こさないようにするためのフラグ
};