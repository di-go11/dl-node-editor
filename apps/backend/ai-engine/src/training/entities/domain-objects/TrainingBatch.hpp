#pragma once
#include "training/entities/domain-objects/BatchData.hpp"

struct TrainingBatch
{
    BatchData input;
    BatchData target;
};