use super::layer::NodeSpec;
use crate::validation::Violations;

// Node
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub id: String,
    pub spec: NodeSpec,
    pub inputs: Vec<NodeInput>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortRef {
    pub node_id: String,
    pub port: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeInput {
    pub port: String,
    pub source: Option<PortRef>, // PortRefを持たない可能性があるため、Optionでラップする。Noneの場合は、入力が未接続であることを示す。
}

// Graph
#[derive(Debug, Clone, PartialEq)]
pub struct ModelGraph {
    pub nodes: Vec<Node>,
    pub outputs: Vec<PortRef>,
}

impl ModelGraph {
    // 各層のパラメータの範囲を確認する。グラフの構造(ポートの接続・閉路など)はまだ確認しない
    // (docs/issues/学習設定の検証をRustに集める.md の段階 2)。
    pub(crate) fn validate_params(&self, v: &mut Violations) {
        for (i, node) in self.nodes.iter().enumerate() {
            node.spec
                .validate(&format!("model_graph.nodes[{i}].spec"), v);
        }
    }
}
