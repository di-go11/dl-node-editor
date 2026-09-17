#include "api/grpc/GrpcApp.hpp"
#include "training/TrainingApp.hpp"

#include <string>

// 起動点(合成層)。TrainingApp(学習)と GrpcApp(gRPC サーバー)、それぞれの
// composition root をここで呼び分けるだけ。どちらの中身も知らない。
int main(int argc, char **argv)
{
    const bool serve = (argc > 1 && std::string(argv[1]) == "--serve");

    if (serve)
    {
        runGrpcServer();
    }
    else
    {
        runTraining();
    }

    return 0;
}
