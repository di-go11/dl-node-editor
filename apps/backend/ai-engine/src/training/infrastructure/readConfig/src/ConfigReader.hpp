#include "training/infrastructure/readConfig/headers/"

ConfigReader::ConfigReader() = default;

AutoConfig ConfigReader::readAll(const std::string &filePath)
{
    DotConfigReader dotConfigReader;
    return dotConfigReader.readAll(filePath);
}