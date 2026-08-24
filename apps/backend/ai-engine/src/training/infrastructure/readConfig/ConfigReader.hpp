#pragma once
#include <string>
#include "training/entities/domain-objects/AppConfig.hpp"

class ConfigReader
{
public:
    AppConfig readAll(const std::string &filePath);

private:
    std::string trim(const std::string &str);
};