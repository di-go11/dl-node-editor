// TrainingProtoMapper(proto <-> ドメインの変換と値の確認)の単体テスト。
// torch に依存しない(ai_engine_grpc / ai_engine_proto と、グラフの検証の GraphValidation.cpp だけをリンクする)。

#include "api/grpc/TrainingProtoMapper.hpp"

#include <cmath>
#include <cstddef>
#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace
{
    int failureCount = 0;

    void check(bool condition, const std::string &message)
    {
        std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
        if (!condition)
        {
            ++failureCount;
        }
    }

    // model_graph にノードを 1 つ足す。層は Conv2D(値はすべて正しい)。入力はつながない。
    model::v1::Node *addConvNode(training::v1::StartTrainingRequest &r, const std::string &id)
    {
        model::v1::Node *node = r.mutable_model_graph()->add_nodes();
        node->set_id(id);
        auto *conv = node->mutable_spec()->mutable_conv2d();
        conv->set_in_channels(3);
        conv->set_out_channels(3);
        conv->set_kernel_size(3);
        conv->set_stride(1);
        conv->set_padding(1);
        conv->set_dilation(1);
        return node;
    }

    // node の入力ポート port に、ノード sourceId の出力ポート sourcePort をつなぐ。
    // sourceId も sourcePort も空 = グラフ入力(画像)。
    void connect(model::v1::Node *node, const std::string &port, const std::string &sourceId, const std::string &sourcePort)
    {
        model::v1::NodeInput *input = node->add_inputs();
        input->set_port(port);
        input->mutable_source()->set_node_id(sourceId);
        input->mutable_source()->set_port(sourcePort);
    }

    void addOutput(training::v1::StartTrainingRequest &r, const std::string &nodeId, const std::string &port)
    {
        model::v1::PortRef *output = r.mutable_model_graph()->add_outputs();
        output->set_node_id(nodeId);
        output->set_port(port);
    }

    // Rust 側が送る想定の、正しいリクエスト(画像セグメンテーション、Conv 1 層)。
    // グラフ: グラフ入力 → conv1(x → y)→ モデルの出力
    // 最小のテスト・フィクスチャ
    training::v1::StartTrainingRequest makeValidRequest()
    {
        training::v1::StartTrainingRequest r;
        r.set_model_name("seg_model-1");
        r.set_model_id("0b6f3c1e-7a2d-4c11-9e55-2f7d8a9b0c13");
        connect(addConvNode(r, "conv1"), "x", "", "");
        addOutput(r, "conv1", "y");

        r.mutable_optimizer()->set_learning_rate(0.005);
        auto *adam = r.mutable_optimizer()->mutable_adam();
        adam->set_beta1(0.9);
        adam->set_beta2(0.999);
        adam->set_eps(1e-8);

        r.mutable_loss()->mutable_cross_entropy();
        r.set_epoch(3);
        r.set_batch(2);
        r.set_dataset_path("/data/train");
        r.set_device("cuda:1");
        r.set_save_last_every(2);

        auto *image = r.mutable_data_spec()->mutable_image();
        image->mutable_annotation()->mutable_pascal_voc()->set_include_difficult(true);
        image->set_input_width(128);
        image->set_input_height(96);
        image->mutable_task_specs()->mutable_segmentation()->set_ignore_index(255);
        return r;
    }

    // model_graph を「conv1, conv2(どちらもグラフ入力から)→ id → モデルの出力」に置き換え、合流するノードを返す。
    // nodes は実行順と逆に並べる(id、conv1、conv2 の順)。層の種類(add / concat)は呼び出し側で設定する。
    model::v1::Node *replaceWithMergeGraph(training::v1::StartTrainingRequest &r, const std::string &id)
    {
        r.mutable_model_graph()->Clear();
        model::v1::Node *merge = r.mutable_model_graph()->add_nodes();
        merge->set_id(id);
        connect(merge, "x", "conv1", "y");
        connect(merge, "x", "conv2", "y");
        connect(addConvNode(r, "conv1"), "x", "", "");
        connect(addConvNode(r, "conv2"), "x", "", "");
        addOutput(r, id, "y");
        return merge;
    }

    // modify で壊したリクエストが invalid_argument で拒否されるか。
    void checkRejected(const std::function<void(training::v1::StartTrainingRequest &)> &modify, const std::string &message)
    {
        training::v1::StartTrainingRequest r = makeValidRequest();
        modify(r);
        bool rejected = false;
        try
        {
            toStartTrainingCommand(r);
        }
        catch (const std::invalid_argument &)
        {
            rejected = true;
        }
        check(rejected, "拒否: " + message);
    }

    // modify で壊したリクエストを変換したときの、invalid_argument のメッセージ。拒否されなければ空。
    std::string rejectionMessage(const std::function<void(training::v1::StartTrainingRequest &)> &modify)
    {
        training::v1::StartTrainingRequest r = makeValidRequest();
        modify(r);
        try
        {
            toStartTrainingCommand(r);
        }
        catch (const std::invalid_argument &e)
        {
            return e.what();
        }
        return "";
    }

    bool contains(const std::string &text, const std::string &part)
    {
        return text.find(part) != std::string::npos;
    }
} // namespace

int main()
{
    // ---------- 正しいリクエストの変換 ----------
    {
        const StartTrainingCommand c = toStartTrainingCommand(makeValidRequest());
        check(c.modelId == "0b6f3c1e-7a2d-4c11-9e55-2f7d8a9b0c13", "変換: model_id(UUID をそのまま通す)");
        check(!c.resume, "変換: resume 未指定は false(最初から学習)");
        check(c.modelGraph.has_value(), "変換: model_graph は検証済みのグラフとして入る");
        if (c.modelGraph.has_value())
        {
            const ModelGraph &g = c.modelGraph->getGraph();
            check(g.nodes.size() == 1 && g.nodes[0].id == "conv1" &&
                      std::holds_alternative<Conv2DSpec>(g.nodes[0].spec) &&
                      std::get<Conv2DSpec>(g.nodes[0].spec).padding == 1,
                  "変換: model_graph のノード(ID と Conv2D)");
            check(g.nodes.size() == 1 && g.nodes[0].inputs.size() == 1 && g.nodes[0].inputs[0].port == "x" &&
                      g.nodes[0].inputs[0].source.nodeId.empty() && g.nodes[0].inputs[0].source.port.empty(),
                  "変換: model_graph の入力の接続(グラフ入力 → x)");
            check(g.outputs.size() == 1 && g.outputs[0].nodeId == "conv1" && g.outputs[0].port == "y",
                  "変換: model_graph の outputs");
        }
        check(std::holds_alternative<AdamOptimizerConfig>(c.optimizer.kind) &&
                  c.optimizer.learningRate == 0.005,
              "変換: optimizer(Adam)");
        check(std::holds_alternative<CrossEntropyConfig>(c.loss), "変換: loss(CrossEntropy)");
        check(c.epochSize == 3 && c.batchSize == 2 && c.saveLastEvery == 2, "変換: epoch / batch / save_last_every");
        check(c.datasetPath == "/data/train", "変換: dataset_path");
        check(c.device.type == ComputeDeviceType::Cuda && c.device.index == 1, "変換: device(cuda:1)");

        const ImageSpec *image = std::get_if<ImageSpec>(&c.dataSpec);
        check(image != nullptr && image->inputWidth == 128 && image->inputHeight == 96, "変換: data_spec.image の入力サイズ");
        check(image != nullptr && std::get<PascalVocConfig>(image->annotation).includeDifficult,
              "変換: data_spec.image.annotation(PascalVoc)");
        const SegmentationSpec *seg = image ? std::get_if<SegmentationSpec>(&image->taskSpecs) : nullptr;
        check(seg != nullptr && seg->ignoreIndex == 255, "変換: task_specs.segmentation.ignore_index");
        check(seg != nullptr && !seg->ignoreColor.has_value(),
              "変換: ignore_color_enabled = false なら ignoreColor は nullopt(r/g/b は読まない)");
    }
    {
        // 独自形式(labelmap.txt 付き)は OriginalConfig になる。
        training::v1::StartTrainingRequest r = makeValidRequest();
        r.mutable_data_spec()->mutable_image()->mutable_annotation()->mutable_original();
        const StartTrainingCommand c = toStartTrainingCommand(r);
        const ImageSpec *image = std::get_if<ImageSpec>(&c.dataSpec);
        check(image != nullptr && std::holds_alternative<OriginalConfig>(image->annotation),
              "変換: data_spec.image.annotation(Original)");
    }
    {
        // 無視する色を有効にすると、r/g/b が ignoreColor に入る。
        training::v1::StartTrainingRequest r = makeValidRequest();
        auto *seg = r.mutable_data_spec()->mutable_image()->mutable_task_specs()->mutable_segmentation();
        seg->set_ignore_color_enabled(true);
        seg->set_ignore_color_r(224);
        seg->set_ignore_color_g(224);
        seg->set_ignore_color_b(192);
        const StartTrainingCommand c = toStartTrainingCommand(r);
        const ImageSpec *image = std::get_if<ImageSpec>(&c.dataSpec);
        const SegmentationSpec *spec = image ? std::get_if<SegmentationSpec>(&image->taskSpecs) : nullptr;
        check(spec != nullptr && spec->ignoreColor.has_value() && spec->ignoreColor->getR() == 224 &&
                  spec->ignoreColor->getG() == 224 && spec->ignoreColor->getB() == 192,
              "変換: task_specs.segmentation.ignore_color(224,224,192)");
    }
    {
        // 無効なら、範囲外の r/g/b が入っていても読まない(拒否しない)。
        training::v1::StartTrainingRequest r = makeValidRequest();
        r.mutable_data_spec()->mutable_image()->mutable_task_specs()->mutable_segmentation()->set_ignore_color_r(999);
        const StartTrainingCommand c = toStartTrainingCommand(r);
        const ImageSpec *image = std::get_if<ImageSpec>(&c.dataSpec);
        const SegmentationSpec *spec = image ? std::get_if<SegmentationSpec>(&image->taskSpecs) : nullptr;
        check(spec != nullptr && !spec->ignoreColor.has_value(), "変換: ignore_color_enabled = false なら r/g/b を検証しない");
    }
    {
        // 分岐のある DAG: conv1 → pool →(y と indices の 2 本)→ unpool → モデルの出力。
        // nodes は実行順と逆に並べて送る(並び順のまま保持され、実行順は別に求まる)。
        training::v1::StartTrainingRequest r = makeValidRequest();
        model::v1::ModelGraph *graph = r.mutable_model_graph();
        graph->Clear();

        model::v1::Node *unpool = graph->add_nodes();
        unpool->set_id("unpool");
        unpool->mutable_spec()->mutable_unpooling()->set_kernel_size(2);
        unpool->mutable_spec()->mutable_unpooling()->set_stride(2);
        connect(unpool, "x", "pool", "y");
        connect(unpool, "indices", "pool", "indices");

        model::v1::Node *pool = graph->add_nodes();
        pool->set_id("pool");
        pool->mutable_spec()->mutable_indexed_pooling()->set_kernel_size(2);
        pool->mutable_spec()->mutable_indexed_pooling()->set_stride(2);
        connect(pool, "x", "conv1", "y");

        connect(addConvNode(r, "conv1"), "x", "", "");
        addOutput(r, "unpool", "y");

        const StartTrainingCommand c = toStartTrainingCommand(r);
        check(c.modelGraph.has_value(), "変換(DAG): 分岐のあるグラフが検証を通る");
        if (c.modelGraph.has_value())
        {
            const ModelGraph &g = c.modelGraph->getGraph();
            check(g.nodes.size() == 3 && g.nodes[0].id == "unpool" && g.nodes[1].id == "pool" && g.nodes[2].id == "conv1",
                  "変換(DAG): nodes は送った並び順のまま");
            check(g.nodes.size() == 3 && std::holds_alternative<UnpoolingSpec>(g.nodes[0].spec) &&
                      std::holds_alternative<IndexedPoolingSpec>(g.nodes[1].spec),
                  "変換(DAG): 層の種類(Unpooling / IndexedPooling)");
            check(g.nodes.size() == 3 && g.nodes[0].inputs.size() == 2 &&
                      g.nodes[0].inputs[0].port == "x" && g.nodes[0].inputs[0].source.nodeId == "pool" &&
                      g.nodes[0].inputs[0].source.port == "y" &&
                      g.nodes[0].inputs[1].port == "indices" && g.nodes[0].inputs[1].source.nodeId == "pool" &&
                      g.nodes[0].inputs[1].source.port == "indices",
                  "変換(DAG): 同じノードから 2 本の接続(y と indices)");
            check(c.modelGraph->getOrder() == std::vector<std::size_t>{2, 1, 0},
                  "変換(DAG): 実行順は conv1 → pool → unpool");
            check(g.outputs.size() == 1 && g.outputs[0].nodeId == "unpool" && g.outputs[0].port == "y",
                  "変換(DAG): outputs");
        }
    }
    {
        // 分岐のある DAG: conv1 → pool →(IndexedPooling の y だけの出力)→ Upsample → モデルの出力。
        // nodes は実行順と逆に並べて送る(並び順のまま保持され、実行順は別に求まる)。
        training::v1::StartTrainingRequest r = makeValidRequest();
        model::v1::ModelGraph *graph = r.mutable_model_graph(); // 書き込み用ポインタを生成して擬似的にグラフを作成する。
        graph->Clear();

        model::v1::Node *upsample = graph->add_nodes();
        upsample->set_id("upsample");
        // 値が渡ったことを区別できるよう、どちらも既定値(Nearest、2 倍)と違う値で送る
        upsample->mutable_spec()->mutable_upsample()->set_upsample_mode(model::v1::UpsampleMode::UPSAMPLE_MODE_BILINEAR); // 双線形補間
        upsample->mutable_spec()->mutable_upsample()->set_scale_factor(4);                                                // 4倍のアップサンプリング
        connect(upsample, "x", "pool", "y");                                                                             // upsample.x ← pool.y

        model::v1::Node *pool = graph->add_nodes();
        pool->set_id("pool");
        pool->mutable_spec()->mutable_indexed_pooling()->set_kernel_size(2);
        pool->mutable_spec()->mutable_indexed_pooling()->set_stride(2);
        connect(pool, "x", "conv1", "y");

        connect(addConvNode(r, "conv1"), "x", "", "");
        addOutput(r, "upsample", "y");

        const StartTrainingCommand c = toStartTrainingCommand(r);
        check(c.modelGraph.has_value(), "変換(Upsample): conv1 → pool → upsample のグラフが検証を通る");
        if (c.modelGraph.has_value())
        {
            const ModelGraph &g = c.modelGraph->getGraph();
            check(g.nodes.size() == 3 && g.nodes[0].id == "upsample" && g.nodes[1].id == "pool" && g.nodes[2].id == "conv1",
                  "変換(Upsample): nodes は送った並び順のまま");
            check(g.nodes.size() == 3 && std::holds_alternative<UpsampleSpec>(g.nodes[0].spec) &&
                      std::holds_alternative<IndexedPoolingSpec>(g.nodes[1].spec),
                  "変換(Upsample): 層の種類(Upsample / IndexedPooling)");
            check(g.nodes.size() == 3 && std::holds_alternative<UpsampleSpec>(g.nodes[0].spec) &&
                      std::get<UpsampleSpec>(g.nodes[0].spec).scaleFactor == 4 &&
                      std::get<UpsampleSpec>(g.nodes[0].spec).upsampleMode == UpsampleMode::Bilinear,
                  "変換(Upsample): scale_factor(4)と upsample_mode(BILINEAR)が渡る");
            check(g.nodes.size() == 3 && g.nodes[0].inputs.size() == 1 &&
                      g.nodes[0].inputs[0].port == "x" && g.nodes[0].inputs[0].source.nodeId == "pool" &&
                      g.nodes[0].inputs[0].source.port == "y",
                  "変換(Upsample): pool の y だけを x につなぐ(indices は使わない)");
            check(c.modelGraph->getOrder() == std::vector<std::size_t>{2, 1, 0},
                  "変換(Upsample): 実行順は conv1 → pool → upsample");
            check(g.outputs.size() == 1 && g.outputs[0].nodeId == "upsample" && g.outputs[0].port == "y",
                  "変換(Upsample): outputs");
        }
    }
    {
        // 合流のある DAG: conv1, conv2(どちらもグラフ入力から)→ add → モデルの出力。
        // nodes は実行順と逆に並べて送る。

        training::v1::StartTrainingRequest r = makeValidRequest();
        r.mutable_model_graph()->Clear();

        model::v1::Node *add = r.mutable_model_graph()->add_nodes();
        add->set_id("add");
        add->mutable_spec()->mutable_add()->set_alpha(0.5);
        connect(addConvNode(r, "conv1"), "x", "", "");
        connect(addConvNode(r, "conv2"), "x", "", "");
        connect(add, "x", "conv1", "y");
        connect(add, "x", "conv2", "y");

        addOutput(r, "add", "y");

        const StartTrainingCommand c = toStartTrainingCommand(r);
        check(c.modelGraph.has_value(), "変換(Add): 合流のあるグラフが検証を通る");
        if (c.modelGraph.has_value())
        {
            const ModelGraph &g = c.modelGraph->getGraph();
            check(g.nodes.size() == 3 && std::holds_alternative<AddSpec>(g.nodes[0].spec) &&
                      std::get<AddSpec>(g.nodes[0].spec).alpha == 0.5,
                  "変換(Add): AddSpec と alpha が渡る");
            check(g.nodes.size() == 3 && g.nodes[0].inputs.size() == 2 &&
                      g.nodes[0].inputs[0].port == "x" && g.nodes[0].inputs[0].source.nodeId == "conv1" &&
                      g.nodes[0].inputs[1].port == "x" && g.nodes[0].inputs[1].source.nodeId == "conv2",
                  "変換(Add): 可変長ポート x への 2 本の接続が、送った順のまま渡る");
            check(!c.modelGraph->getOrder().empty() && c.modelGraph->getOrder().back() == 0,
                  "変換(Add): add は最後に実行される");
        }
    }
    {
        // Add の alpha 未指定: proto3 では 0 と区別できないので、0 は既定の 1.0(単純な和)として扱う
        training::v1::StartTrainingRequest r = makeValidRequest();
        replaceWithMergeGraph(r, "add")->mutable_spec()->mutable_add(); // alpha は設定しない
        const StartTrainingCommand c = toStartTrainingCommand(r);
        check(c.modelGraph.has_value() && std::holds_alternative<AddSpec>(c.modelGraph->getGraph().nodes[0].spec) &&
                  std::get<AddSpec>(c.modelGraph->getGraph().nodes[0].spec).alpha == 1.0,
              "変換(Add): alpha 未指定(0)は 1.0 として扱う");
    }
    {
        // 合流のある DAG: conv1, conv2 → concat → モデルの出力。つないだ順にチャンネルが並ぶので、順番が保たれることを確かめる。
        training::v1::StartTrainingRequest r = makeValidRequest();
        replaceWithMergeGraph(r, "concat")->mutable_spec()->mutable_concat();

        const StartTrainingCommand c = toStartTrainingCommand(r);
        check(c.modelGraph.has_value(), "変換(Concat): 合流のあるグラフが検証を通る");
        if (c.modelGraph.has_value())
        {
            const ModelGraph &g = c.modelGraph->getGraph();
            check(g.nodes.size() == 3 && std::holds_alternative<ConcatSpec>(g.nodes[0].spec),
                  "変換(Concat): ConcatSpec として渡る");
            check(g.nodes.size() == 3 && g.nodes[0].inputs.size() == 2 &&
                      g.nodes[0].inputs[0].port == "x" && g.nodes[0].inputs[0].source.nodeId == "conv1" &&
                      g.nodes[0].inputs[1].port == "x" && g.nodes[0].inputs[1].source.nodeId == "conv2",
                  "変換(Concat): 可変長ポート x への 2 本の接続が、送った順のまま渡る");
            check(!c.modelGraph->getOrder().empty() && c.modelGraph->getOrder().back() == 0,
                  "変換(Concat): concat は最後に実行される");
            check(g.outputs.size() == 1 && g.outputs[0].nodeId == "concat" && g.outputs[0].port == "y",
                  "変換(Concat): outputs");
        }
    }
    {
        // seed: 未指定は nullopt、0 を含む指定値はそのまま渡る
        training::v1::StartTrainingRequest r = makeValidRequest();
        check(!toStartTrainingCommand(r).seed.has_value(), "変換: seed 未指定は nullopt");
        r.mutable_seed()->set_value(0);
        const auto zero = toStartTrainingCommand(r).seed;
        check(zero.has_value() && *zero == 0, "変換: seed = 0 は有効な値として渡る");
        r.mutable_seed()->set_value(18446744073709551615ULL);
        const auto big = toStartTrainingCommand(r).seed;
        check(big.has_value() && *big == 18446744073709551615ULL, "変換: seed は uint64 の最大値まで保持する");
    }
    {
        // resume = true はそのまま渡る(再開できるかはマッパーではなく checkTrainingJobPreconditions が見る)
        training::v1::StartTrainingRequest r = makeValidRequest();
        r.set_resume(true);
        check(toStartTrainingCommand(r).resume, "変換: resume = true");
    }
    {
        // model_name は C++ では使わないので、空でも拒否しない(ファイル名は model_id で決まる)
        training::v1::StartTrainingRequest r = makeValidRequest();
        r.set_model_name("");
        check(toStartTrainingCommand(r).modelId == "0b6f3c1e-7a2d-4c11-9e55-2f7d8a9b0c13",
              "変換: model_name が空でも model_id があれば通る");
    }
    {
        // ignore_index = 0 は正しい値として通す(拒否しない)
        training::v1::StartTrainingRequest r = makeValidRequest();
        r.mutable_data_spec()->mutable_image()->mutable_task_specs()->mutable_segmentation()->set_ignore_index(0);
        const StartTrainingCommand c = toStartTrainingCommand(r);
        check(std::get<SegmentationSpec>(std::get<ImageSpec>(c.dataSpec).taskSpecs).ignoreIndex == 0,
              "変換: ignore_index = 0 は拒否しない(Rust 側の契約で担保)");
    }

    // ---------- 拒否されるリクエスト ----------
    checkRejected([](auto &r)
                  { r.set_model_id(""); }, "model_id が空(全学習が同じ checkpoint を共有してしまう)");
    checkRejected([](auto &r)
                  { r.set_model_id("../evil"); }, "model_id にパスの区切りが含まれる");
    checkRejected([](auto &r)
                  { r.set_resume_from("/somewhere/model_last.pt"); }, "resume_from は廃止(resume を使う)");
    checkRejected([](auto &r)
                  { r.clear_model_graph(); }, "model_graph.nodes が空");
    checkRejected([](auto &r)
                  { r.mutable_model_graph()->add_nodes()->set_id("n2"); }, "層の種類が未指定");
    checkRejected([](auto &r)
                  { r.mutable_model_graph()->mutable_nodes(0)->mutable_spec()->mutable_conv2d()->set_kernel_size(0); },
                  "conv2d.kernel_size = 0");
    checkRejected([](auto &r)
                  {
                      model::v1::Node *node = r.mutable_model_graph()->add_nodes();
                      node->set_id("pool");
                      node->mutable_spec()->mutable_pooling2d()->set_kernel_size(2); },
                  "pooling_type が UNSPECIFIED");
    // Add の alpha は有限の数値に限る(理由まで確かめるため、メッセージで判定する)
    check(contains(rejectionMessage([](auto &r)
                                    { replaceWithMergeGraph(r, "add")->mutable_spec()->mutable_add()->set_alpha(
                                          std::numeric_limits<double>::infinity()); }),
                   "add.alpha は有限の数値にしてください"),
          "拒否: Add の alpha が無限大");
    check(contains(rejectionMessage([](auto &r)
                                    { replaceWithMergeGraph(r, "add")->mutable_spec()->mutable_add()->set_alpha(
                                          std::numeric_limits<double>::quiet_NaN()); }),
                   "add.alpha は有限の数値にしてください"),
          "拒否: Add の alpha が NaN");

    // グラフの検証(ValidatedModelGraph::create)で見つかる問題も、invalid_argument になる
    checkRejected([](auto &r)
                  { r.mutable_model_graph()->mutable_nodes(0)->set_id(""); }, "ノード ID が空");
    checkRejected([](auto &r)
                  { connect(addConvNode(r, "conv1"), "x", "conv1", "y"); }, "ノード ID が重複");
    checkRejected([](auto &r)
                  { connect(addConvNode(r, "conv/2"), "x", "conv1", "y"); }, "ノード ID に使えない文字");
    checkRejected([](auto &r)
                  { connect(addConvNode(r, "conv2"), "x", "missing", "y"); }, "存在しない参照先");
    checkRejected([](auto &r)
                  { addConvNode(r, "conv2"); }, "未接続の入力ポート");
    checkRejected([](auto &r)
                  { connect(addConvNode(r, "conv2"), "x", "conv1", "indices"); },
                  "参照先に無い出力ポート(Conv2D の indices)");
    checkRejected([](auto &r)
                  {
                      model::v1::Node *node = addConvNode(r, "conv2");
                      connect(node, "x", "conv1", "y");
                      connect(node, "x", "conv1", "y"); },
                  "1 本しかつなげないポートに 2 本");
    checkRejected([](auto &r)
                  {
                      // conv1.x ← conv2.y、conv2.x ← conv1.y
                      model::v1::PortRef *source = r.mutable_model_graph()->mutable_nodes(0)->mutable_inputs(0)->mutable_source();
                      source->set_node_id("conv2");
                      source->set_port("y");
                      connect(addConvNode(r, "conv2"), "x", "conv1", "y"); },
                  "閉路");
    checkRejected([](auto &r)
                  { r.mutable_model_graph()->clear_outputs(); }, "outputs が空");
    checkRejected([](auto &r)
                  { addOutput(r, "conv1", "y"); }, "outputs が 2 個");
    checkRejected([](auto &r)
                  { r.mutable_model_graph()->mutable_outputs(0)->set_node_id("missing"); },
                  "outputs の参照先が存在しない");

    // エラーの位置は、ノードの添字と ID で示す
    check(contains(rejectionMessage([](auto &r)
                                    { r.mutable_model_graph()->mutable_nodes(0)->mutable_spec()->mutable_conv2d()->set_kernel_size(0); }),
                   "model_graph.nodes[0](id=conv1).spec.conv2d.kernel_size"),
          "エラーの位置: model_graph.nodes[0](id=conv1).spec.conv2d.kernel_size");
    check(contains(rejectionMessage([](auto &r)
                                    { connect(addConvNode(r, "conv2"), "x", "missing", "y"); }),
                   "model_graph が不正です"),
          "エラーの位置: グラフの検証のエラーは「model_graph が不正です」で始まる");
    check(contains(rejectionMessage([](auto &r)
                                    {
                                        model::v1::Node *node = addConvNode(r, "conv2");
                                        connect(node, "x", "conv1", "y");
                                        connect(node, "z", "missing", "y"); }),
                   "model_graph.nodes[1](id=conv2).inputs[1]: 参照先のノードが存在しません: missing"),
          "エラーの位置: 入力の接続は model_graph.nodes[1](id=conv2).inputs[1]");
    check(contains(rejectionMessage([](auto &r)
                                    { addConvNode(r, "conv2"); }),
                   "model_graph.nodes[1](id=conv2) の入力ポート 'x': 必須の入力ポートがつながっていません"),
          "エラーの位置: 未接続のポートは、ノードの位置とポート名");
    check(contains(rejectionMessage([](auto &r)
                                    { r.mutable_model_graph()->mutable_nodes(0)->set_id(""); }),
                   "model_graph.nodes[0](id=): ノード ID が空です"),
          "エラーの位置: ID が空のノードは添字でわかる");
    check(contains(rejectionMessage([](auto &r)
                                    { r.mutable_model_graph()->mutable_outputs(0)->set_node_id("missing"); }),
                   "model_graph.outputs[0]: outputs の参照先のノードが存在しません: missing"),
          "エラーの位置: outputs は model_graph.outputs[0]");
    check(contains(rejectionMessage([](auto &r)
                                    {
                                        model::v1::PortRef *source = r.mutable_model_graph()->mutable_nodes(0)->mutable_inputs(0)->mutable_source();
                                        source->set_node_id("conv2");
                                        source->set_port("y");
                                        connect(addConvNode(r, "conv2"), "x", "conv1", "y"); }),
                   "model_graph: グラフに閉路があります。実行できないノード: conv1, conv2"),
          "エラーの位置: 閉路はグラフ全体の問題として、実行できないノードを示す");
    {
        // 問題が複数あるときは、最初の 1 つで止めずに、すべて報告する
        const std::string message = rejectionMessage([](auto &r)
                                                     {
                                                         connect(addConvNode(r, "conv2"), "x", "missing", "y");
                                                         r.mutable_model_graph()->mutable_outputs(0)->set_port("z"); });
        check(contains(message, "model_graph.nodes[1](id=conv2).inputs[0]") && contains(message, "model_graph.outputs[0]"),
              "エラーの位置: 複数の問題をすべて報告する");
    }
    checkRejected([](auto &r)
                  { r.clear_optimizer(); }, "optimizer が未指定");
    checkRejected([](auto &r)
                  { r.mutable_optimizer()->set_learning_rate(0.0); }, "optimizer.learning_rate = 0");
    checkRejected([](auto &r)
                  { r.mutable_optimizer()->mutable_adam()->set_eps(0.0); }, "adam.eps = 0");
    checkRejected([](auto &r)
                  { r.clear_loss(); }, "loss が未指定");
    checkRejected([](auto &r)
                  { r.set_epoch(0); }, "epoch = 0");
    checkRejected([](auto &r)
                  { r.set_batch(0); }, "batch = 0");
    checkRejected([](auto &r)
                  { r.set_dataset_path(""); }, "dataset_path が空");
    checkRejected([](auto &r)
                  { r.set_device("gpu"); }, "device が不正");
    checkRejected([](auto &r)
                  { r.clear_data_spec(); }, "data_spec が未指定");
    checkRejected([](auto &r)
                  { r.mutable_data_spec()->mutable_image()->set_input_width(0); }, "input_width = 0");
    checkRejected([](auto &r)
                  { r.mutable_data_spec()->mutable_image()->clear_task_specs(); }, "task_specs が未指定");
    checkRejected([](auto &r)
                  { r.mutable_data_spec()->mutable_image()->clear_annotation(); }, "annotation が未指定");
    checkRejected([](auto &r)
                  { r.mutable_data_spec()->mutable_image()->mutable_task_specs()->mutable_segmentation()->set_ignore_index(256); },
                  "ignore_index = 256(範囲外)");
    checkRejected([](auto &r)
                  {
                      auto *seg = r.mutable_data_spec()->mutable_image()->mutable_task_specs()->mutable_segmentation();
                      seg->set_ignore_color_enabled(true);
                      seg->set_ignore_color_g(256);
                  },
                  "ignore_color_g = 256(範囲外)");

    // ---------- TrainingStatus の変換 ----------
    check(toProtoTrainingStatus(TrainingStatus::Idle) == training::v1::TRAINING_STATUS_IDLE &&
              toProtoTrainingStatus(TrainingStatus::Running) == training::v1::TRAINING_STATUS_RUNNING &&
              toProtoTrainingStatus(TrainingStatus::Completed) == training::v1::TRAINING_STATUS_COMPLETED &&
              toProtoTrainingStatus(TrainingStatus::Failed) == training::v1::TRAINING_STATUS_FAILED &&
              toProtoTrainingStatus(TrainingStatus::Stopped) == training::v1::TRAINING_STATUS_STOPPED,
          "TrainingStatus: 5 つの状態が proto の値に対応する");

    // ---------- StreamProgressResponse ----------
    {
        // 1 エポックも終わっていない: epoch = 0、metrics は未設定
        TrainingProcessSnapshot s;
        s.status = TrainingStatus::Failed;
        s.errorMessage = "boom";
        training::v1::StreamProgressResponse res;
        fillStreamProgressResponse(s, res);
        check(res.epoch() == 0 && res.metrics_case() == training::v1::StreamProgressResponse::METRICS_NOT_SET,
              "進捗(エポックなし): epoch = 0、metrics は未設定");
        check(res.status() == training::v1::TRAINING_STATUS_FAILED && res.error_message() == "boom",
              "進捗(エポックなし): status と error_message");
    }
    {
        TrainingProcessSnapshot s;
        s.status = TrainingStatus::Running;
        s.hasEpochReport = true;
        s.latest.epoch = 4; // 0 から数えて 4 = 5 エポック終了
        s.latest.trainLoss = 0.4;
        s.latest.validation.loss = 0.3;
        s.latest.epochElapsedMs = 1200;
        s.latest.totalElapsedMs = 6000;
        SegmentationMetricsConfig seg{};
        seg.pixelAccuracy = 0.9;
        seg.meanIoU = 0.5;
        seg.fwIoU = 0.8;
        seg.meanClassAccuracy = 0.6;
        seg.perClassIoU = {0.9, std::nan(""), 0.1};
        s.latest.validation.taskMetrics = seg;

        training::v1::StreamProgressResponse res;
        fillStreamProgressResponse(s, res);
        check(res.epoch() == 5, "進捗: epoch は終了したエポック数(EpochReport::epoch + 1)");
        check(res.train_loss() == 0.4 && res.val_loss() == 0.3, "進捗: train_loss / val_loss");
        check(res.epoch_elapsed_ms() == 1200 && res.total_elapsed_ms() == 6000, "進捗: 経過時間");
        check(res.has_segmentation() && res.segmentation().miou() == 0.5 && res.segmentation().fw_iou() == 0.8,
              "進捗: segmentation の指標");
        check(res.has_segmentation() && res.segmentation().per_class_iou_size() == 3 &&
                  std::isnan(res.segmentation().per_class_iou(1)),
              "進捗: per_class_iou(NaN も含めてそのまま送る)");
    }

    if (failureCount == 0)
    {
        std::cout << "All training proto mapper tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
