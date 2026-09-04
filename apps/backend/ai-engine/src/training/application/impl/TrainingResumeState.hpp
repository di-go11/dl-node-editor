#pragma once

// 学習ループの「開始状態」。
//
// どの .pt から再開するか(あるいは再開しないか)を決めるのは合成層の責務であり、
// TrainModelUsecase はその結果としての開始状態を受け取るだけにする。
// これにより Usecase は「resume かどうか」を知らずに済む
// (cold start は既定値の TrainingResumeState{} を渡すのと同じ)。
struct TrainingResumeState
{
    // 学習を開始するエポック番号。
    // loadLast() の meta.epoch は「最後に完了したエポック」なので、
    // 合成層は startEpoch = meta.epoch + 1 を渡す。
    unsigned int startEpoch = 0;

    // 過去の run で記録したベスト指標値。BestMetricTracker の初期値になる。
    double initialBest = 0.0;

    // initialBest が有効かどうか。false なら tracker はまっさらな状態で始まり、
    // 最初のエポックが必ず「ベスト更新」になる。
    bool hasInitialBest = false;
};
