use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub download_url: String,
    pub checked_at: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    html_url: String,
    prerelease: bool,
}

fn compare_versions(current: &str, latest: &str) -> bool {
    let current_parts: Vec<u32> = current
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    let latest_parts: Vec<u32> = latest
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    for i in 0..3 {
        let c = current_parts.get(i).unwrap_or(&0);
        let l = latest_parts.get(i).unwrap_or(&0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}

#[tauri::command]
pub async fn check_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.github.com/repos/ant-video/dev-toolkit/releases/latest")
        .header("User-Agent", "DevToolkit-UpdateChecker")
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let latest_version = release.tag_name.trim_start_matches('v');
    let has_update = compare_versions(current_version, latest_version);

    Ok(UpdateInfo {
        has_update,
        current_version: current_version.to_string(),
        latest_version: latest_version.to_string(),
        release_notes: release.body.unwrap_or_default(),
        download_url: release.html_url,
        checked_at: chrono::Local::now().to_rfc3339(),
    })
}
