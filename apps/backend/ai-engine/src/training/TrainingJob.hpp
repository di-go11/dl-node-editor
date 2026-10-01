#pragma once

#include "training/application/impl/ServerConfig.hpp"
#include "training/application/impl/StartTrainingCommand.hpp"
#include "training/entities/domain-objects/TrainingStatus.hpp"

#include <memory>

class ISeed;
class ITrainingProgressObserver;
class TrainingStopToken;

// 学習ジョブ1件分の合成層(composition root)。CLI(TrainingApp)と gRPC の両方から呼ぶ。
// server(サーバー側の設定)と command(ジョブの依頼)から学習パイプラインを組み立て、
// cold start / resume を判定し、学習ループを最後まで(または停止要求まで)回す。
// command.modelGraph は呼び出し側が埋めておくこと(空なら例外)。
//
// progressObserver: エポックごとの結果の通知先(onEpochCompleted だけが呼ばれる)。
// seedApplier: 乱数シードの適用先(借用)。command.seed が指定されたときだけ、モデル構築より前に適用する。
// stopToken: 停止要求。nullptr なら止められない。
// 戻り値: Completed または Stopped。失敗は例外で返るので、onFinished での終了通知は呼び出し側が行う。
TrainingStatus runTrainingJob(const ServerConfig &server,
                              const StartTrainingCommand &command,
                              const std::shared_ptr<ITrainingProgressObserver> &progressObserver,
                              const ISeed &seedApplier,
                              const TrainingStopToken *stopToken = nullptr);
