#include "training/infrastructure/dataset/PreFetchDatasetRepository.hpp"

PreFetchDatasetRepository::PreFetchDatasetRepository(std::shared_ptr<IDatasetRepository> datasetRepository)
    : _datasetRepository(std::move(datasetRepository))
{
    startWorker();
}

PreFetchDatasetRepository::~PreFetchDatasetRepository()
{
    stopWorker();
}

// ==== ワーカースレッド ====
void PreFetchDatasetRepository::workerLoop()
{
    try
    {
        while (true)
        {
            {
                std::unique_lock lock(_mutex); //
                _producerCv.wait(lock, [&]
                                 { return _stop || !_nextBatch.has_value(); }); // 箱が空くまで待機
                if (_stop)
                    return;
            }

            // 重い読み込みはロックの外で行う。(ロックしたままだと、消費者側が待たされて並列にならない。)
            if (!_datasetRepository->hasNext()) // 次のバッチ分がない場合終了
            {
                std::lock_guard lock(_mutex); // これは?ロックと違うの?
                _finished = true;
                break;
            }
            TrainingBatch batch = _datasetRepository->getNextBatch();

            {
                std::lock_guard lock(_mutex);
                _nextBatch.emplace(std::move(batch)); // 箱に移す
            }

            _consumerCv.notify_one(); // これは何?
        }
    }
    catch (...)
    {
        std::lock_guard lock(_mutex);
        _error = std::current_exception();
        _finished = true;
    }
    _consumerCv.notify_one();
}

// ====消費者(学習側)スレッド====
bool PreFetchDatasetRepository::hasNext() const
{
    std::unique_lock lock(_mutex);
    _consumerCv.wait(lock, [&]
                     { return _nextBatch.has_value() || _finished; });
    if (!_nextBatch && _error)
    {
        std::rethrow_exception(_error);
    }
    return _nextBatch.has_value();
}

TrainingBatch PreFetchDatasetRepository::getNextBatch()
{
    std::unique_lock lock(_mutex);
    _consumerCv.wait(lock, [&]
                     { return _nextBatch.has_value() || _finished; });
    if (!_nextBatch)
    {
        if (_error)
        {
            std::rethrow_exception(_error);
        }
        throw std::out_of_range("PreFetchDatasetRepository: no more batches");
    }
    TrainingBatch batch = std::move(*_nextBatch); // 取り出す
    _nextBatch.reset();                           // 空にする
    lock.unlock();
    _producerCv.notify_one(); // ワーカーに「空いた」ことを伝える
    return batch;
}

// ====reset/スレッド管理====
void PreFetchDatasetRepository::reset()
{
    stopWorker();
    _datasetRepository->reset();
    {
        std::lock_guard lock(_mutex);
        _nextBatch.reset();
        _finished = false;
        _stop = false;
        _error = nullptr;
    }
    startWorker();
}

void PreFetchDatasetRepository::startWorker()
{
    _worker = std::thread(&PreFetchDatasetRepository::workerLoop, this); // これは何?
}

void PreFetchDatasetRepository::stopWorker()
{
    {
        std::lock_guard lock(_mutex);
        _stop = true;
    }
    _producerCv.notify_all(); // これは何?
    if (_worker.joinable())
    {
        _worker.join(); // これはスレッドを追加しているの?
    }
}