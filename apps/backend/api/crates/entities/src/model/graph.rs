use super::layer::NodeSpec;

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
