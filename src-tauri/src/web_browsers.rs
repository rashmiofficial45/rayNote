#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebBrowser {
    bundle_id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
}

#[cfg(target_os = "macos")]
fn browser_icon(path: &str) -> Option<String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use tauri_nspanel::objc2_foundation::{
        NSDataBase64EncodingOptions, NSDictionary, NSPoint, NSRect, NSSize, NSString,
    };

    let workspace = NSWorkspace::sharedWorkspace();
    let icon = workspace.iconForFile(&NSString::from_str(path));
    let mut rect = NSRect::new(NSPoint::ZERO, NSSize::new(32.0, 32.0));
    // Request a small representation for the picker and only pass PNG data to the webview.
    let image = unsafe { icon.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
    use objc2::AnyThread;
    let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
    let png = unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
    let base64 = png.base64EncodedStringWithOptions(NSDataBase64EncodingOptions::empty());
    Some(format!("data:image/png;base64,{base64}"))
}

#[cfg(target_os = "macos")]
fn declares_browser_role(bundle: &tauri_nspanel::objc2_foundation::NSBundle) -> bool {
    use tauri_nspanel::objc2_foundation::{NSArray, NSDictionary, NSString};

    let Some(url_types) = bundle
        .objectForInfoDictionaryKey(&NSString::from_str("CFBundleURLTypes"))
        .and_then(|types| types.downcast::<NSArray>().ok())
    else {
        return false;
    };
    let rank_key = NSString::from_str("LSHandlerRank");
    let schemes_key = NSString::from_str("CFBundleURLSchemes");
    url_types.iter().any(|entry| {
        let Some(entry) = entry.downcast_ref::<NSDictionary>() else {
            return false;
        };
        let rank = entry
            .objectForKey(&rank_key)
            .and_then(|rank| rank.downcast::<NSString>().ok());
        if rank.is_some_and(|rank| matches!(rank.to_string().as_str(), "Alternate" | "None")) {
            return false;
        }
        let Some(schemes) = entry
            .objectForKey(&schemes_key)
            .and_then(|schemes| schemes.downcast::<NSArray>().ok())
        else {
            return false;
        };
        // Utility apps can intercept web URLs as part of a custom deep-link registration.
        !schemes.is_empty()
            && schemes.iter().all(|scheme| {
                scheme
                    .downcast_ref::<NSString>()
                    .is_some_and(|scheme| matches!(scheme.to_string().as_str(), "http" | "https"))
            })
    })
}

#[cfg(target_os = "macos")]
fn registered_browsers(schemes: &[&str]) -> Vec<(WebBrowser, String)> {
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSWorkspace;
    use tauri_nspanel::objc2_foundation::{NSBundle, NSString, NSURL};

    autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        let mut browsers: Vec<(WebBrowser, String)> = Vec::new();
        for scheme in schemes {
            let probe = NSString::from_str(&format!("{scheme}://example.com"));
            let Some(url) = NSURL::URLWithString(&probe) else {
                continue;
            };
            let default_app = workspace.URLForApplicationToOpenURL(&url);
            for app_url in workspace.URLsForApplicationsToOpenURL(&url).iter() {
                let Some(path) = app_url.path().map(|path| path.to_string()) else {
                    continue;
                };
                if !std::path::Path::new(&path).is_dir() {
                    continue;
                }
                let Some(bundle) = NSBundle::bundleWithURL(&app_url) else {
                    continue;
                };
                if default_app.as_deref() != Some(app_url.as_ref())
                    && !declares_browser_role(&bundle)
                {
                    continue;
                }
                let Some(bundle_id) = bundle.bundleIdentifier().map(|id| id.to_string()) else {
                    continue;
                };
                if browsers
                    .iter()
                    .any(|(browser, _)| browser.bundle_id == bundle_id)
                {
                    continue;
                }
                let name = std::path::Path::new(&path)
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or(&bundle_id)
                    .to_owned();
                browsers.push((WebBrowser { bundle_id, name, icon: None }, path));
            }
        }
        browsers
    })
}

#[tauri::command]
pub async fn list_web_browsers() -> Vec<WebBrowser> {
    #[cfg(target_os = "macos")]
    {
        use std::collections::HashMap;
        use std::sync::{Mutex, OnceLock};
        static ICONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

        let mut installed = registered_browsers(&["https", "http"]);
        installed.sort_by_cached_key(|(browser, _)| browser.name.to_lowercase());
        let mut icons = ICONS.get_or_init(Mutex::default).lock().unwrap_or_else(|e| e.into_inner());
        icons.retain(|path, _| installed.iter().any(|(_, installed_path)| path == installed_path));
        objc2::rc::autoreleasepool(|_| {
            installed.into_iter().map(|(mut browser, path)| {
                if !icons.contains_key(&path) {
                    if let Some(icon) = browser_icon(&path) {
                        icons.insert(path.clone(), icon);
                    }
                }
                browser.icon = icons.get(&path).cloned();
                browser
            }).collect()
        })
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

#[tauri::command]
pub async fn open_web_link_in_browser(url: String, bundle_id: String) -> Result<(), String> {
    let url = tauri::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Expected an HTTP or HTTPS link".into());
    }

    #[cfg(target_os = "macos")]
    {
        let (_, path) = registered_browsers(&[url.scheme()])
            .into_iter()
            .find(|(browser, _)| browser.bundle_id == bundle_id)
            .ok_or("The selected browser is unavailable")?;
        let status = std::process::Command::new("/usr/bin/open")
            .args(["-a", &path, url.as_str()])
            .status()
            .map_err(|error| error.to_string())?;
        return status
            .success()
            .then_some(())
            .ok_or_else(|| "Could not open the selected browser".into());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle_id;
        Err("Browser selection requires macOS".into())
    }
}
