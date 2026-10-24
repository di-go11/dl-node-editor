use super::layer::NodeSpec;

// Node
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    id: String,
    spec: NodeSpec,
    inputs: Vec<NodeInput>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortRef {
    node_id: String,
    port: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeInput {
    port: String,
    source: Option<PortRef>,
}

// Graph
#[derive(Debug, Clone, PartialEq)]
pub struct ModelGraph {
    nodes: Vec<Node>,
    outputs: Vec<PortRef>,
}
