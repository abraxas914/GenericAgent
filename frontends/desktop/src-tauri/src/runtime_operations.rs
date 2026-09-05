use std::sync::Mutex;

/// Owns the complete configuration / bootstrap / rollback transaction.
pub struct RuntimeOperations(Mutex<()>);

impl RuntimeOperations {
    pub const fn new() -> Self {
        Self(Mutex::new(()))
    }

    pub fn run<T>(&self, task: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _guard = self.0.lock().map_err(|_| "runtime operation lock poisoned".to_string())?;
        task()
    }

    pub fn switch_source<T>(
        &self,
        next: Option<String>,
        read: impl FnOnce() -> Option<String>,
        write: impl Fn(Option<String>) -> Result<(), String>,
        restart: impl Fn() -> Result<T, String>,
    ) -> Result<T, String> {
        self.run(|| {
            let previous = read();
            write(next)?;
            match restart() {
                Ok(root) => Ok(root),
                Err(error) => {
                    write(previous).map_err(|rollback| format!(
                        "{error}; restoring the previous workspace setting failed: {rollback}"
                    ))?;
                    match restart() {
                        Ok(_) => Err(error),
                        Err(rollback) => Err(format!(
                            "{error}; restoring the previous workspace also failed: {rollback}"
                        )),
                    }
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn a_second_switch_cannot_read_or_write_during_rollback() {
        let operations = Arc::new(RuntimeOperations::new());
        let setting = Arc::new(Mutex::new(Some("original".to_string())));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first_operations = operations.clone();
        let first_setting = setting.clone();
        let first = thread::spawn(move || {
            first_operations.switch_source(
                Some("broken".into()),
                || first_setting.lock().unwrap().clone(),
                |value| { *first_setting.lock().unwrap() = value; Ok(()) },
                || {
                    let current = first_setting.lock().unwrap().clone();
                    if current.as_deref() == Some("broken") {
                        entered_tx.send(()).unwrap();
                        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                        Err("start failed".into())
                    } else { Ok(current) }
                },
            )
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (read_tx, read_rx) = mpsc::channel();
        let second_setting = setting.clone();
        let second = thread::spawn(move || operations.switch_source(
            Some("next".into()),
            || {
                let previous = second_setting.lock().unwrap().clone();
                read_tx.send(previous.clone()).unwrap();
                previous
            },
            |value| { *second_setting.lock().unwrap() = value; Ok(()) },
            || Ok(second_setting.lock().unwrap().clone()),
        ));
        assert!(read_rx.recv_timeout(Duration::from_millis(50)).is_err());
        release_tx.send(()).unwrap();
        assert_eq!(first.join().unwrap(), Err("start failed".into()));
        assert_eq!(read_rx.recv_timeout(Duration::from_secs(5)).unwrap().as_deref(), Some("original"));
        assert_eq!(second.join().unwrap().unwrap().as_deref(), Some("next"));
        assert_eq!(setting.lock().unwrap().as_deref(), Some("next"));
    }
}
