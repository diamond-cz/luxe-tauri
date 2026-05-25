//! One-liner poetry fetcher. Equivalent of hiz's `PoetryWorker(QThread)`.

use crate::error::AppResult;
use serde::Deserialize;

const ENDPOINT:  &str = "https://v2.jinrishici.com/one.json";
const USER_TOKEN:&str = "X-User-Token";
const UA:        &str = "Mozilla/5.0 (LUXE Tauri)";
const DEFAULT:   &str = "少年听雨歌楼上，红烛昏罗帐";

#[derive(Deserialize)]
struct JinrishiciResponse {
    data: Option<DataField>,
}
#[derive(Deserialize)]
struct DataField {
    content: Option<String>,
}

pub async fn fetch_one() -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    match client
        .get(ENDPOINT)
        .header(USER_TOKEN, "")
        .header("User-Agent", UA)
        .send()
        .await
    {
        Ok(resp) => {
            let parsed: JinrishiciResponse = resp.json().await?;
            Ok(parsed.data.and_then(|d| d.content).unwrap_or_else(|| DEFAULT.into()))
        }
        Err(err) => {
            tracing::warn!(%err, "poetry fetch failed, using default");
            Ok(DEFAULT.into())
        }
    }
}
