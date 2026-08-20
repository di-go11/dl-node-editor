#include "training/infrastructure/readConfig/headers/ConfigReader.hpp"

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <iostream>

ConfigReader::ConfigReader() = default;

AppConfig ConfigReader::readAll(const std::string &filePath)
{
    AppConfig appConfig;
    std::ifstream file(filePath);

    if (!file.is_open())
    {
        throw std::runtime_error("Could not open config file: " + filePath);
    }
    int lineNumber = 0;

    std::string line;
    while (std::getline(file, line))
    {
        lineNumber++;
        // 余計な空白の除去
        line = trim(line);

        // 空行、または「#」で始まる行は無視
        if (line.empty() || line[0] == '#')
        {
            continue;
        }

        // '=' の位置を探して, keyとvalueに分割
        auto delimiterPos = line.find('=');
        if (delimiterPos == std::string::npos)
        {
            throw std::runtime_error("Invalid config line at " + std::to_string(lineNumber) + ": " + line);
        }

        std::string key = trim(line.substr(0, delimiterPos));
        std::string value = trim(line.substr(delimiterPos + 1));

        try
        {
            if (key == "optimizer_type")
            {
                if (value == "Adam")
                {
                    appConfig.optimizer.type = OptimizerType::Adam;
                }
                else if (value == "SGD")
                {
                    appConfig.optimizer.type = OptimizerType::SGD;
                }
                else if (value == "AdamW")
                {
                    appConfig.optimizer.type = OptimizerType::AdamW;
                }
                else
                {
                    throw std::runtime_error("Unknown optimizer type: " + value);
                }
            }
            else if (key == "Activefunction_type")
            {
                if (value == "ReLU")
                {
                    appConfig.activation.activationType = ActivationType::ReLU;
                }
                else if (value == "Sigmoid")
                {
                    appConfig.activation.activationType = ActivationType::Sigmoid;
                }
                else if (value == "Tanh")
                {
                    appConfig.activation.activationType = ActivationType::Tanh;
                }
                else if (value == "Softmax")
                {
                    appConfig.activation.activationType = ActivationType::Softmax;
                }
                else
                {
                    throw std::runtime_error("Unknown activation type: " + value);
                }
            }
            else if (key == "learning_rate")
            {
                if (value.empty())
                {
                    throw std::runtime_error("Learning rate value is empty");
                }
                else if (value > "1.0" || value < "0.0")
                {
                    throw std::runtime_error("Learning rate value is out of range (0.0 - 1.0): " + value);
                }
                appConfig.optimizer.learningRate = std::stod(value);
            }
            else if (key == "weight_decay")
            {
                if (value.empty())
                {
                    throw std::runtime_error("Weight decay value is empty");
                }
                appConfig.optimizer.weightDecay = std::stod(value);
            }
            else
            {
                throw std::runtime_error("Unknown config key: " + key);
            }
        }
        catch (const std::exception &e)
        {
            throw std::runtime_error("Error parsing config line at " + std::to_string(lineNumber) + ": " + e.what());
        }
    }
    return appConfig;
}

std::string ConfigReader::trim(const std::string &str)
{
    const char *whitespace = " \t\n\r\f\v";
    size_t start = str.find_first_not_of(whitespace);
    size_t end = str.find_last_not_of(whitespace);

    if (start == std::string::npos || end == std::string::npos)
    {
        return "";
    }

    return str.substr(start, end - start + 1);
}