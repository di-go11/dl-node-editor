#pragma once

class IOptimizer
{
public:
    virtual ~IOptimizer() = default;
    virtual void resetGradients() = 0;
    virtual void updateParmeters() = 0;
};