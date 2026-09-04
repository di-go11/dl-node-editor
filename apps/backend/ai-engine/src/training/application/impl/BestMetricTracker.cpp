#include "training/application/impl/BestMetricTracker.hpp"

#include <cmath>

BestMetricTracker::BestMetricTracker(MetricMode mode)
    : _mode(mode), _bestValue(0.0), _hasBest(false)
{
}

BestMetricTracker::BestMetricTracker(MetricMode mode, double initialBest)
    : _mode(mode), _bestValue(initialBest), _hasBest(true)
{
}

bool BestMetricTracker::update(double value)
{
    if (std::isnan(value))
    {
        return false;
    }

    if (!_hasBest)
    {
        _bestValue = value;
        _hasBest = true;
        return true;
    }

    const bool improved = (_mode == MetricMode::Max) ? (value > _bestValue)
                                                     : (value < _bestValue);
    if (improved)
    {
        _bestValue = value;
        return true;
    }
    return false;
}

double BestMetricTracker::best() const
{
    return _bestValue;
}

bool BestMetricTracker::hasBest() const
{
    return _hasBest;
}
