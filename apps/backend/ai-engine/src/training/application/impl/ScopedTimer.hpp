// 計測の開始と終了を、スコープに結びつけて、RAIIにより時間の計測を行うためのクラス

#pragma once

#include "training/application/interfaces/ITimeRecorder.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"
#include <string>

class ScopedTimer
{
public:
    ScopedTimer(ITimeRecorder &timeRecorder, const std::string &name);
    ~ScopedTimer();
    ScopedTimer(const ScopedTimer &) = delete;            // コンストラクタを用いたオブジェクトのコピー禁止(コピーコンストラクタは明示しない場合自動で作成されるメンバであり、それを削除するという意味を持つ。)
    ScopedTimer &operator=(const ScopedTimer &) = delete; // 　代入によるオブジェクトのコピー禁止
private:
    ITimeRecorder &_timeRecorder;
    ProcessTimeSpan _processTimeSpan;
};

// RAII(Resource Acquisition Is Initialization)の原則に従い、ScopedTimerオブジェクトが生成されると計測を開始し、オブジェクトが破棄されると計測を終了する。
// デストラクタで、副作用のある処理(解放、記録、ロック)を行うクラスは、コピーの意味を明示させておく必要がある。これがないと、コピーコンストラクタやコピー代入演算子が暗黙的に生成されてしまい、意図しないコピーが発生し、記録が重複したり、ロックが二重にかかるなどの問題が発生する可能性がある。