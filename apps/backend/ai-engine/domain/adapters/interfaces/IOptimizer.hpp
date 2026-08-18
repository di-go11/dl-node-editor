#pragma once

class IOptimizer
{
public:
    virtual ~IOptimizer() = default;
    virtual void step() = 0;
};