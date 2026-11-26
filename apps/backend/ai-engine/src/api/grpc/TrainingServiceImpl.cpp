#include "TrainingServiceImpl.hpp"

#include "api/grpc/TrainingProtoMapper.hpp"
#include "training/ModelGraphCheck.hpp"

#include <chrono>
#include <cstdint>
#include <memory>
#include <stdexcept>

namespace
{
    // StreamProgress が更新を待つ1回あたりの時間。この間隔でクライアントの切断を確認する。
    constexpr std::chrono::milliseconds kProgressWaitTimeout{500};

    bool isFinished(TrainingStatus status)
    {
        return status == TrainingStatus::Completed ||
               status == TrainingStatus::Failed ||
               status == TrainingStatus::Stopped;
    }
}

TrainingServiceImpl::TrainingServiceImpl(ITrainingJobManager &jobManager)
    : _jobManager(jobManager)
{
}

grpc::Status TrainingServiceImpl::StartTraining(grpc::ServerContext * /*context*/,
                                                const training::v1::StartTrainingRequest *request,
                                                training::v1::StartTrainingResponse *response)
{
    StartTrainingCommand command;
    try
    {
        command = toStartTrainingCommand(*request);
    }
    catch (const std::invalid_argument &e)
    {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, e.what());
    }

    try
    {
        response->set_job_id(_jobManager.start(command));
        response->set_status(training::v1::TRAINING_STATUS_RUNNING);
        return grpc::Status::OK;
    }
    catch (const TrainingJobBusyError &e)
    {
        return grpc::Status(grpc::StatusCode::ABORTED, e.what());
    }
    catch (const TrainingPreconditionError &e)
    {
        return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION, e.what());
    }
    catch (const std::invalid_argument &e)
    {
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, e.what());
    }
}

grpc::Status TrainingServiceImpl::StreamProgress(grpc::ServerContext *context,
                                                 const training::v1::StreamProgressRequest *request,
                                                 grpc::ServerWriter<training::v1::StreamProgressResponse> *writer)
{
    std::shared_ptr<ITrainingInfoProvider> progress;
    try
    {
        progress = _jobManager.progress(request->job_id());
    }
    catch (const TrainingJobNotFoundError &e)
    {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, e.what());
    }

    // after_epoch の指定があれば、その続きのエポックを飛ばさずに全部送る(履歴の保存用)。
    if (request->start_position_case() == training::v1::StreamProgressRequest::kAfterEpoch)
    {
        uint32_t cursor = request->after_epoch(); // 送信済みのエポック数(response.epoch と同じ数え方)
        uint64_t lastVersion = 0;
        while (!context->IsCancelled())
        {
            const EpochBatch batch = progress->waitForEpochsAfter(cursor, lastVersion, kProgressWaitTimeout);
            if (batch.version == lastVersion)
            {
                continue; // タイムアウト。切断を確認してから待ち直す
            }
            lastVersion = batch.version;

            // 途中のエポックは RUNNING で送る
            for (const EpochReport &report : batch.reports)
            {
                TrainingProcessSnapshot one;
                one.status = TrainingStatus::Running;
                one.hasEpochReport = true;
                one.latest = report;

                training::v1::StreamProgressResponse response;
                fillStreamProgressResponse(one, response);
                if (!writer->Write(response))
                {
                    return grpc::Status::OK; // クライアントが切断した
                }
                cursor = report.epoch + 1u;
            }

            // 全エポックのあとに、終了を 1 回だけ送る(epoch は 0 になる)
            if (isFinished(batch.status))
            {
                TrainingProcessSnapshot last;
                last.status = batch.status;
                last.errorMessage = batch.errorMessage;

                training::v1::StreamProgressResponse response;
                fillStreamProgressResponse(last, response);
                writer->Write(response);
                break;
            }
        }
        return grpc::Status::OK;
    }

    // lastVersion = 0 から始めるので、最初の1件は今の状態がすぐ返る(開始済みのジョブは version >= 1)。
    // 更新を待っている間に複数の更新があった場合は、最新の状態だけを送る(途中の更新は飛ばされる)。
    uint64_t lastVersion = 0;
    while (!context->IsCancelled())
    {
        const TrainingProcessSnapshot snapshot = progress->waitForUpdate(lastVersion, kProgressWaitTimeout);
        if (snapshot.version == lastVersion)
        {
            continue; // タイムアウト。切断を確認してから待ち直す
        }
        lastVersion = snapshot.version;

        training::v1::StreamProgressResponse response;
        fillStreamProgressResponse(snapshot, response);
        if (!writer->Write(response))
        {
            break; // クライアントが切断した
        }
        if (isFinished(snapshot.status))
        {
            break; // 終了の状態を送ったらストリームを閉じる
        }
    }
    return grpc::Status::OK;
}

grpc::Status TrainingServiceImpl::StopTraining(grpc::ServerContext * /*context*/,
                                               const training::v1::StopTrainingRequest *request,
                                               training::v1::StopTrainingResponse *response)
{
    try
    {
        // 停止はエポックの区切りで行われるので、ここで返る状態はまだ RUNNING のことがある。
        // 実際に止まったかは StreamProgress の STOPPED で知る。
        response->set_status(toProtoTrainingStatus(_jobManager.requestStop(request->job_id())));
        return grpc::Status::OK;
    }
    catch (const TrainingJobNotFoundError &e)
    {
        return grpc::Status(grpc::StatusCode::NOT_FOUND, e.what());
    }
}

grpc::Status TrainingServiceImpl::ValidateModelGraph(grpc::ServerContext * /*context*/,
                                                     const training::v1::ValidateModelGraphRequest *request,
                                                     training::v1::ValidateModelGraphResponse *response)
{
    ModelGraphCheckRequest check;
    try
    {
        check = toModelGraphCheckRequest(*request);
    }
    catch (const std::invalid_argument &e)
    {
        // 層のパラメータの値などは Rust が先に確かめるので、ここに来るのは Rust 側の検証漏れ
        return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT, e.what());
    }

    try
    {
        fillValidateModelGraphResponse(checkModelGraph(check.graph, check.dataSpec, check.datasetPath), *response);
        return grpc::Status::OK;
    }
    catch (const TrainingPreconditionError &e)
    {
        return grpc::Status(grpc::StatusCode::FAILED_PRECONDITION, e.what()); // データセットの色表が読めない
    }
    catch (const std::exception &e)
    {
        // 構造の検証が通った後の create や形の計算での想定外の失敗。gRPC のスレッドの外に例外を出さない
        return grpc::Status(grpc::StatusCode::INTERNAL, e.what());
    }
}
