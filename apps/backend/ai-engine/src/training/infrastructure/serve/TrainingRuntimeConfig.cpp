#include "./TrainingRuntimeConfig.hpp"

#include <charconv>

TrainingRuntimeConfig::TrainingRuntimeConfig()
{
    checkpointOutputDirPath = "models";
    imageLoadThreadCount = 1;
    enableProcessTimeMeasurement = false;
}

bool TrainingRuntimeConfig::setImageLoadThreadCount(std::string_view value)
{
    size_t parsed = 0;
    const auto [end, ec] = std::from_chars(value.data(), value.data() + value.size(), parsed);
    if (ec != std::errc{} || end != value.data() + value.size() || parsed == 0)
    {
        return false;
    }
    imageLoadThreadCount = parsed;
    return true;
}