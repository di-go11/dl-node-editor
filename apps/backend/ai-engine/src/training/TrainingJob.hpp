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
// 学習ループを最後まで(または停止要求まで)回す。
// command.resume = true なら <modelId>_last.pt から再開し、false なら(ファイルがあっても)最初から学習する。
// command.modelGraph は呼び出し側が埋めておくこと(未設定なら例外)。
// 開始条件を満たさなければ、checkTrainingJobPreconditions と同じ例外を投げる。
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

// 学習を始める前に、依頼がいまの checkpoint の状態で実行できるかを確かめる。
// gRPC では学習スレッドを起動する前に呼び、ここで投げた例外をそのまま応答に返す。
//   - command.modelId が空                                       → std::invalid_argument
//   - resume = true で <modelId>_last.pt がない / 読めない        → TrainingPreconditionError
//   - resume = true で checkpoint がすでに epochSize まで学習済み  → TrainingPreconditionError
// resume = false なら checkpoint は読まない。
void checkTrainingJobPreconditions(const ServerConfig &server, const StartTrainingCommand &command);
