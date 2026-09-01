#pragma once

#include "training/application/interfaces/IModelStore.hpp"

#include <string>

class IModel;

class TorchModelStore : public IModelStore
{
public:
    void save(const IModel &model, const std::string &path) override;
    void load(IModel &model, const std::string &path) override;
};