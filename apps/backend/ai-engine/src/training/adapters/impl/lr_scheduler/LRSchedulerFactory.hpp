#pragma once

#include "StepLR.hpp"
#include "PolyLR.hpp"
#include "CosineLR.hpp"
#include "WarmupLR.hpp"
#include "training/adapters/interfaces/ILearningRateScheduler.hpp"
#include "training/entities/domain-objects/Optimizer/LearningRateSchedulerConfig.hpp"


#include <memory>

std::shared_ptr<ILearningRateScheduler> createLRScheduler(const LearningRateSchedulerConfig &config, unsigned int totalEpochs);