#pragma once

#include <string>

#include "training/entities/domain-objects/CheckpointMeta.hpp"

// 学習チェックポイント(モデル重み + optimizer 状態 + epoch)の永続化 / 復元ポート。
// application 層はこの口だけを知り、「何を・どこに・どの形式で」保存/読み込みするかは
// infrastructure 実装に委ねる。
class ICheckpointStore
{
public:
    virtual ~ICheckpointStore() = default;

    // ベストモデル更新時に呼ばれ、管理下のディレクトリへ「ベスト」チェックポイントを書き出す。
    virtual void saveBest(const CheckpointMeta &meta) = 0;

    // 中断・再開用に、毎エポック(または N エポックごと)に「直近」チェックポイントを書き出す。
    virtual void saveLast(const CheckpointMeta &meta) = 0;

    // 管理下のベストチェックポイントを読み、注入済みの model / optimizer に復元する。
    // 戻り値は保存時のメタ情報(epoch / bestMetric)。存在しない場合は例外を投げる。
    virtual CheckpointMeta loadBest() = 0;

    // 中断・再開(resume)用に、管理下の直近チェックポイントを読んで復元する。
    // 戻り値の epoch は「最後に完了したエポック」。存在しない場合は例外を投げる。
    virtual CheckpointMeta loadLast() = 0;

    // 任意のチェックポイントファイルを読み、注入済みの model / optimizer に復元する。
    // checkpointPath は上位(最終的には GUI → API 経由)で決まる。
    // 戻り値は保存時のメタ情報。ファイルが存在しない / 形式が不正な場合は例外を投げる。
    virtual CheckpointMeta loadFrom(const std::string &checkpointPath) = 0;
};
