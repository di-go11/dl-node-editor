use std::{collections::HashMap, eprintln, future::Future};

use tokio::{
    sync::mpsc,
    task::{self, JoinSet},
};

use entities::training::JobId;
use usecases::training::ProgressRecordingScheduler;

// ProgressRecordingSchedulerからはSenderを使用する。Reciverは直接使わないため構造体では包まない
#[derive(Clone)]
pub struct ChannelRecordingScheduler {
    tx: mpsc::UnboundedSender<JobId>,
}

impl ProgressRecordingScheduler for ChannelRecordingScheduler {
    fn schedule(&self, job_id: JobId) {
        if let Err(e) = self.tx.send(job_id) {
            eprintln!("recording worker is not running {}", e.0.as_str());
        }
    }
}

// 送信者がStartTrainingとResumeProgressRecordingの2ヶ所なため
pub fn recording_channel() -> (ChannelRecordingScheduler, mpsc::UnboundedReceiver<JobId>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (ChannelRecordingScheduler { tx }, rx)
}

// 記録はクロージャで外から受け取り、ワーカーは受け取ったjob_idごとにタスクを起動して管理する

pub async fn run_recording_worker<F, Fut>(mut rx: mpsc::UnboundedReceiver<JobId>, record: F)
where
    F: Fn(JobId) -> Fut,
    Fut: Future<Output = ()> + Send + 'static,
{
    let mut tasks = JoinSet::new();
    let mut running: HashMap<task::Id, JobId> = HashMap::new(); // キーはタスクID、値はジョブIDとすることで、タスク終了時に必ずJoinSetから受け取ることができるIDを保持し、また、同じjob_idの二重起動を防ぐ、
    loop {
        tokio::select! {
            Some(job_id) = rx.recv() => {
                if running.values().any(|j| j == &job_id) { continue; } // 二重起動を防ぐ
                let handle = tasks.spawn(record(job_id.clone())); // タスクを起動し、そのIDをrunningに登録
                running.insert(handle.id(), job_id); // タスクIDとジョブIDを紐付けて保持
            }
            Some(res) = tasks.join_next_with_id() => {
                // panic で終わったタスクも running から外す
                let id = match res { Ok((id, ())) => id, Err(e) => e.id() };
                running.remove(&id);
            }
            else => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;
    #[tokio::test]
    async fn test_two_times_same_job_id() -> Result<(), Box<dyn std::error::Error>> {
        let (schedule, rx) = recording_channel();
        let count = Arc::new(AtomicUsize::new(0));
        let job_id = JobId::new("1".to_string())?;
        schedule.schedule(job_id.clone());
        schedule.schedule(job_id);
        drop(schedule); // チャネルを閉じる。->タスク終了後にワーカーが終了する

        let c = Arc::clone(&count);
        let record = |_job_id: JobId| {
            c.fetch_add(1, Ordering::SeqCst); //起動された回数を共有カウンタで数える
            async {
                // 記録が続いている状況を再現する（1回目がまだ動いている間に2回目が届くようにする
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            }
        };
        run_recording_worker(rx, record).await;
        assert_eq!(count.load(Ordering::SeqCst), 1); // 1回しか起動されていないことを確認する
        Ok(())
    }
    #[tokio::test(start_paused = true)]
    async fn test_work_same_job_id_after_finished_first() {
        let (schedule, rx) = recording_channel();
        let count = Arc::new(AtomicUsize::new(0));

        let c = Arc::clone(&count);
        let record = move |_job_id: JobId| {
            c.fetch_add(1, Ordering::SeqCst); //起動された回数を共有カウンタで数える
            async {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            }
        };

        // ワーカーを裏で動かす
        let worker = tokio::spawn(run_recording_worker(rx, record));

        let job_id = JobId::new("1".to_string()).unwrap();
        schedule.schedule(job_id.clone());
        tokio::time::sleep(Duration::from_secs(20)).await; // 1回目のタスクが終了するまで待つ
        schedule.schedule(job_id);
        drop(schedule);

        worker.await.unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 2); // 2回目も起動されていることを確認する
    }
}
