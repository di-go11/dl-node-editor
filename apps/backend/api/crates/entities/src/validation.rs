// 設定の検証で見つかった違反。
// 違反は最初の 1 つで止めずにすべて集め、まとめて返す(フロントで欄ごとにまとめて表示するため)。
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct ConfigViolation {
    // 違反のある項目の位置(例: "optimizer.learning_rate"、"model_graph.nodes[3].spec.stride")。
    // HTTP の JSON と同じ項目名にしてあるので、フロントはこれで違反のある欄を特定できる。
    pub field: String,
    pub message: String,
}

// 違反を集める入れ物。各項目の validate はこれに違反を足していく。
#[derive(Debug, Default)]
pub(crate) struct Violations(Vec<ConfigViolation>);

impl Violations {
    pub(crate) fn push(&mut self, field: impl Into<String>, message: impl Into<String>) {
        self.0.push(ConfigViolation {
            field: field.into(),
            message: message.into(),
        });
    }

    pub(crate) fn at_least(&mut self, field: &str, value: i64, min: i64) {
        if value < min {
            self.push(field, format!("{min} 以上にしてください({value})"));
        }
    }

    pub(crate) fn at_most(&mut self, field: &str, value: i64, max: i64) {
        if value > max {
            self.push(field, format!("{max} 以下にしてください({value})"));
        }
    }

    // f64 の確認では、比較が常に false になる NaN も違反にする
    pub(crate) fn greater_than_zero(&mut self, field: &str, value: f64) {
        if value.is_nan() || value <= 0.0 {
            self.push(field, format!("0 より大きくしてください({value})"));
        }
    }

    pub(crate) fn non_negative(&mut self, field: &str, value: f64) {
        if value.is_nan() || value < 0.0 {
            self.push(field, format!("0 以上にしてください({value})"));
        }
    }

    pub(crate) fn finite(&mut self, field: &str, value: f64) {
        if !value.is_finite() {
            self.push(field, format!("有限の値にしてください({value})"));
        }
    }

    pub(crate) fn into_result(self) -> Result<(), Vec<ConfigViolation>> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(self.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Violations;

    fn count(f: impl FnOnce(&mut Violations)) -> usize {
        let mut v = Violations::default();
        f(&mut v);
        v.into_result().err().map_or(0, |e| e.len())
    }

    #[test]
    fn at_least_and_at_most_include_the_bound() {
        assert_eq!(count(|v| v.at_least("x", 1, 1)), 0);
        assert_eq!(count(|v| v.at_least("x", 0, 1)), 1);
        assert_eq!(count(|v| v.at_most("x", 255, 255)), 0);
        assert_eq!(count(|v| v.at_most("x", 256, 255)), 1);
    }

    #[test]
    fn float_checks_reject_nan() {
        assert_eq!(count(|v| v.greater_than_zero("x", f64::NAN)), 1);
        assert_eq!(count(|v| v.non_negative("x", f64::NAN)), 1);
        assert_eq!(count(|v| v.finite("x", f64::NAN)), 1);
        assert_eq!(count(|v| v.finite("x", f64::INFINITY)), 1);
    }

    #[test]
    fn greater_than_zero_rejects_zero_but_non_negative_accepts_it() {
        assert_eq!(count(|v| v.greater_than_zero("x", 0.0)), 1);
        assert_eq!(count(|v| v.non_negative("x", 0.0)), 0);
        assert_eq!(count(|v| v.non_negative("x", -0.1)), 1);
    }

    #[test]
    fn into_result_is_ok_when_nothing_was_pushed() {
        assert!(Violations::default().into_result().is_ok());
    }
}
