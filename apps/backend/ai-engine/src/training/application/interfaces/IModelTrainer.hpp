#pragma once

#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/NormalizedImageData.hpp"

class TrainParam;

class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;
    virtual void train(
        BatchData<NormalizedImageData> &inputBatchData,
        BatchData<ImageData> &targetBatchData,
        TrainParam &trainParam) = 0;
};
