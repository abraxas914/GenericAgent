use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static NEXT_CAPTURE: AtomicU64 = AtomicU64::new(0);

struct Capture(PathBuf);

impl Capture {
    fn new() -> io::Result<Self> {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ga-probe-{}-{stamp}-{}", std::process::id(), NEXT_CAPTURE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path)?;
        Ok(Self(path))
    }

    fn file(&self, name: &str) -> io::Result<File> {
        OpenOptions::new().write(true).create_new(true).open(self.0.join(name))
    }

    fn read(&self, name: &str, limit: u64) -> io::Result<Vec<u8>> {
        let mut bytes = Vec::new();
        File::open(self.0.join(name))?.take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit {
            return Err(io::Error::other("probe output exceeded limit"));
        }
        Ok(bytes)
    }
}

impl Drop for Capture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

/// Spool outside memory so inherited output handles cannot leave a reader thread
/// blocked after the probe exits. Check file growth while waiting, then read at
/// most limit + 1 bytes. Temporary captures are removed on every return path.
pub fn run(command: &mut Command, timeout: Duration, limit: u64) -> io::Result<Output> {
    let capture = Capture::new()?;
    let stdout = capture.file("stdout")?;
    let stderr = capture.file("stderr")?;
    command.stdin(Stdio::null()).stdout(stdout.try_clone()?).stderr(stderr.try_clone()?);
    let spawned = command.spawn();
    command.stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = spawned?;
    let started = Instant::now();
    let result = (|| {
        loop {
            if stdout.metadata()?.len() > limit || stderr.metadata()?.len() > limit {
                return Err(io::Error::other("probe output exceeded limit"));
            }
            if let Some(status) = child.try_wait()? {
                return Ok(Output {
                    status,
                    stdout: capture.read("stdout", limit)?,
                    stderr: capture.read("stderr", limit)?,
                });
            }
            if started.elapsed() >= timeout {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "probe timed out"));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn collects_a_successful_probe() {
        let output = run(Command::new("sh").args(["-c", "printf '{\"ok\":true}'; printf note >&2"]), Duration::from_secs(2), 1024).unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"{\"ok\":true}");
        assert_eq!(output.stderr, b"note");
    }

    #[test]
    fn terminates_a_stalled_probe() {
        let started = Instant::now();
        let error = run(Command::new("sh").args(["-c", "exec sleep 30"]), Duration::from_millis(100), 1024).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn rejects_unbounded_probe_output() {
        let error = run(Command::new("sh").args(["-c", "while :; do printf 'excessive output'; done"]), Duration::from_secs(3), 1024).unwrap_err();
        assert!(error.to_string().contains("output exceeded"));
    }
}
