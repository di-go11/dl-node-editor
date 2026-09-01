#pragma once

#include <string>

class IModel;

class IModelStore
{
public:
    virtual ~IModelStore() = default;
    virtual void save(const IModel &model, const std::string &path) = 0;
    virtual void load(IModel &model, const std::string &path) = 0;
};