#include "TrainingJobManager.hpp"

#include "training/adapters/impl/TrainingProgressStore.hpp"
#include "training/application/impl/TrainingStopToken.hpp"

#include <exception>
#include <utility>
#include <random>
#include <iostream>
#include <torch/torch.h>

TrainingJobManager::TrainingJobManager(JobRunner runner, JobPreflight preflight)
    : _runner(std::move(runner)), _preflight(std::move(preflight))
{
}

TrainingJobManager::~TrainingJobManager()
{
    std::lock_guard<std::mutex> lock(_mutex);
    for (auto &[jobId, job] : _jobs)
    {
        job.stopToken->requestStop();
    }
    for (auto &[jobId, job] : _jobs)
    {
        if (job.thread.joinable())
        {
            job.thread.join();
        }
    }
}

std::string TrainingJobManager::start(const StartTrainingCommand &command)
{
    std::lock_guard<std::mutex> lock(_mutex);
    joinFinishedThreadsLocked();

    for (const auto &[jobId, job] : _jobs)
    {
        if (!job.finished->load())
        {
            throw TrainingJobBusyError("TrainingJobManager: ジョブ " + jobId + " が実行中です");
        }
    }

    // 実行中のジョブがないことを確かめてから検査する(実行中なら Busy を優先して返す)。
    // checkpoint の読み込みを含むので少し時間がかかるが、その間に別の start が割り込まないよう、ロックを持ったまま行う。
    if (_preflight)
    {
        _preflight(command);
    }

    const std::string jobId = "job-" + std::to_string(_nextJobNumber++) + "-" + std::to_string(std::random_device{}());

    Job job;
    job.store = std::make_shared<TrainingProgressStore>();
    job.stopToken = std::make_shared<TrainingStopToken>();
    job.finished = std::make_shared<std::atomic<bool>>(false);

    // job_id を返す前に Running にしておく(クライアントが知っているジョブは必ず Running 以降になる)。
    job.store->start();

    // スレッドには shared_ptr のコピーを渡す(Job がコピーされても、実体は共有される)。
    job.thread = std::thread(
        [runner = _runner, command, store = job.store, stopToken = job.stopToken, finished = job.finished]
        {
            try
            {
                const TrainingStatus status = runner(command, store, stopToken.get());
                store->onFinished(status, "");
            }
            // torchに関するエラー(モデル構造やOOMなど)
            catch (const c10::Error &e)
            {
                std::cerr << e.what() << std::endl;
                store->onFinished(TrainingStatus::Failed, e.what_without_backtrace());
            }
            // データ参照などでデータが見つからないなどにtorch外のエラー
            catch (const std::exception &e)
            {
                store->onFinished(TrainingStatus::Failed, e.what());
            }

            catch (...)
            {
                store->onFinished(TrainingStatus::Failed, "unknown error");
            }
            finished->store(true);
        });

    _jobs.emplace(jobId, std::move(job));
    return jobId;
}

TrainingStatus TrainingJobManager::requestStop(const std::string &jobId)
{
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _jobs.find(jobId);
    if (it == _jobs.end())
    {
        throw TrainingJobNotFoundError("TrainingJobManager: ジョブ " + jobId + " は存在しません");
    }
    it->second.stopToken->requestStop();
    return it->second.store->getTrainingProcessSnapshot().status;
}

std::shared_ptr<ITrainingInfoProvider> TrainingJobManager::progress(const std::string &jobId)
{
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _jobs.find(jobId);
    if (it == _jobs.end())
    {
        throw TrainingJobNotFoundError("TrainingJobManager: ジョブ " + jobId + " は存在しません");
    }
    return it->second.store;
}

void TrainingJobManager::joinFinishedThreadsLocked()
{
    for (auto &[jobId, job] : _jobs)
    {
        if (job.finished->load() && job.thread.joinable())
        {
            job.thread.join();
        }
    }
}
