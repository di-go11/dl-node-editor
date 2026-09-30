#pragma once

#include "training.pb.h"

#include "training/application/impl/StartTrainingCommand.hpp"
#include "training/application/interfaces/ITrainingInfoProvider.hpp"
#include "training/entities/domain-objects/TrainingStatus.hpp"

// proto(training::v1)とドメインの型の変換。生成コードに触れてよいのは gRPC 層だけなので、ここに置く。
// proto とドメインで同じ名前の型が多い(ImageSpec, LossConfig など)ため、
// using namespace training::v1 は使わず、proto 側は必ず training::v1:: を付けて書く。

// StartTrainingRequest を StartTrainingCommand に変換する。
// 0 のままだと学習が壊れる値や、oneof / enum の指定漏れは std::invalid_argument を投げる
// (docs/issues/start-training-request-contract.md の「C++ 側に残す確認」)。
// ignore_index は 0 も正しい値なので拒否しない(Rust 側で必ず埋める契約)。
StartTrainingCommand toStartTrainingCommand(const training::v1::StartTrainingRequest &request);

training::v1::TrainingStatus toProtoTrainingStatus(TrainingStatus status);

// snapshot を StreamProgressResponse に詰める。
// epoch は「終了したエポック数」(= EpochReport::epoch + 1)。1 エポックも終わっていなければ 0 で、metrics は未設定。
void fillStreamProgressResponse(const TrainingProcessSnapshot &snapshot, training::v1::StreamProgressResponse &response);
