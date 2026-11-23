use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSample {
    uptime_ns: u64,
    logical_cores: u32,
    processes: Vec<ProcessSample>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSample {
    pid: i32,
    start: u64,
    cpu_ns: u64,
    footprint_bytes: u64,
    gpu_ns: Option<u64>,
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::{msg_send, runtime::AnyObject, sel};
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::Manager;

    #[repr(C)]
    #[derive(Default)]
    struct ProcessUsage {
        start: u64,
        cpu_ns: u64,
        footprint_bytes: u64,
        gpu_ns: u64,
        gpu_available: bool,
    }

    extern "C" {
        fn raynote_process_usage(pid: i32, usage: &mut ProcessUsage) -> bool;
        fn raynote_sample_uptime() -> u64;
        #[cfg(target_arch = "aarch64")]
        fn raynote_gpu_usage(pids: *const i32, count: usize, times: *mut u64) -> bool;
    }

    pub async fn sample(app: tauri::AppHandle) -> Result<ResourceSample, String> {
        let mut receivers = Vec::new();
        for label in ["main", "settings"] {
            let Some(window) = app.get_webview_window(label) else {
                continue;
            };
            let (send, receive) = mpsc::channel();
            window
                .with_webview(move |webview| {
                    let view = webview.inner().cast::<AnyObject>();
                    let mut pids = [0, 0];
                    // WebKit helpers are XPC services. Their parent PID cannot identify their owning app.
                    unsafe {
                        if msg_send![view, respondsToSelector: sel!(_webProcessIdentifier)] {
                            pids[0] = msg_send![view, _webProcessIdentifier];
                        }
                        if msg_send![view, respondsToSelector: sel!(_gpuProcessIdentifier)] {
                            pids[1] = msg_send![view, _gpuProcessIdentifier];
                        }
                    }
                    let _ = send.send(pids);
                })
                .map_err(|error| error.to_string())?;
            receivers.push(receive);
        }

        tauri::async_runtime::spawn_blocking(move || {
            let mut pids = vec![std::process::id() as i32];
            for receiver in receivers {
                let helpers = receiver
                    .recv_timeout(Duration::from_millis(750))
                    .map_err(|error| error.to_string())?;
                pids.extend(helpers.into_iter().filter(|pid| *pid > 0));
            }
            pids.sort_unstable();
            pids.dedup();

            #[cfg(target_arch = "aarch64")]
            let gpu_times = {
                let mut times = vec![0; pids.len()];
                let available =
                    unsafe { raynote_gpu_usage(pids.as_ptr(), pids.len(), times.as_mut_ptr()) };
                if available {
                    times.into_iter().map(Some).collect::<Vec<_>>()
                } else {
                    vec![None; pids.len()]
                }
            };
            #[cfg(not(target_arch = "aarch64"))]
            let gpu_times = vec![None; pids.len()];

            let mut processes = Vec::new();
            for (pid, gpu_time) in pids.into_iter().zip(gpu_times) {
                let mut data = ProcessUsage::default();
                if unsafe { raynote_process_usage(pid, &mut data) } {
                    processes.push(ProcessSample {
                        pid,
                        start: data.start,
                        cpu_ns: data.cpu_ns,
                        footprint_bytes: data.footprint_bytes,
                        gpu_ns: gpu_time.or_else(|| data.gpu_available.then_some(data.gpu_ns)),
                    });
                } else {
                    return Err("A rayNote process exited or could not be sampled".into());
                }
            }
            // This is the machine's logical core count, including idle cores.
            let logical_cores =
                std::thread::available_parallelism().map_or(1, |count| count.get() as u32);
            Ok(ResourceSample {
                uptime_ns: unsafe { raynote_sample_uptime() },
                logical_cores,
                processes,
            })
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[tauri::command]
pub async fn get_resource_sample(app: tauri::AppHandle) -> Result<ResourceSample, String> {
    #[cfg(target_os = "macos")]
    return macos::sample(app).await;

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Resource sampling is available on macOS".into())
    }
}
