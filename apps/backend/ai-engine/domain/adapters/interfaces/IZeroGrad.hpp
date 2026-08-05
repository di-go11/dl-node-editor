#pragma once

class IZeroGrad
{
public:
    virtual ~IZeroGrad() = default;
    virtual void zeroGrad() = 0;
};