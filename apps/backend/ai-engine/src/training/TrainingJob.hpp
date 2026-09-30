#pragma once

#include "training/application/impl/ServerConfig.hpp"
#include "training/application/impl/StartTrainingCommand.hpp"

// 学習ジョブ1件分の合成層(composition root)。CLI(TrainingApp)と gRPC の両方から呼ぶ。
// server(サーバー側の設定)と command(ジョブの依頼)から学習パイプラインを組み立て、
// cold start / resume を判定し、学習ループを最後まで回す。
// command.modelGraph は呼び出し側が埋めておくこと(空なら例外)。
void runTrainingJob(const ServerConfig &server, const StartTrainingCommand &command);
