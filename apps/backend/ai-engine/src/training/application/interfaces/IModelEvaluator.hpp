#pragma once

struct EpochMetrics;
class IDatasetRepository;

class IModelEvaluator
{
public:
    virtual ~IModelEvaluator() = default;

    virtual EpochMetrics evaluate(IDatasetRepository &valData) = 0;
};