#include "NullTimeRecorder.hpp"

void NullTimeRecorder::record(const ProcessTimeSpan &)
{
    // Do nothing(計測オフのときの Null Object。引数は使わないので名前を付けない)
}