#pragma once

#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"

#include <condition_variable>
#include <mutex>
#include <memory>
#include <optional>
#include <exception>
#include <stdexcept>
#include <thread>

class PreFetchDatasetRepository : public IDatasetRepository // Decoratorパターン
{
public:
    explicit PreFetchDatasetRepository(std::shared_ptr<IDatasetRepository> datasetRepository);
    ~PreFetchDatasetRepository();

    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;

private:
    void startWorker();
    void stopWorker();
    void workerLoop();

    mutable std::mutex _mutex;                   // メンバ関数が、非constなため、mutableを付与
    mutable std::condition_variable _consumerCv; // 生産→消費
    std::condition_variable _producerCv;         // 消費→生産

    std::optional<TrainingBatch> _nextBatch; // オブジェクトであるため、無効値が存在しない(値が入っていない場合は無効など)だからといって、entityのメンバ変数に追加するのは一番内側の層が変更するためopenclosedの原則に反する。だから、ここで無効値を表現できるoptionalを使う。
    bool _finished = false;
    bool _stop = false;
    std::exception_ptr _error;

    std::shared_ptr<IDatasetRepository> _datasetRepository;
    std::thread _worker;
};