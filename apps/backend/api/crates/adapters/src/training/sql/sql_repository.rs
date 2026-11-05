use sqlx::SqlitePool;
#[derive(Clone)]
pub struct SqliteTrainingRepository {
    pub(super) pool: SqlitePool, // sql/select.rs からも使うため training モジュール内に公開
}

impl SqliteTrainingRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}
