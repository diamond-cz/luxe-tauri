//! One-liner poetry fetcher. Equivalent of hiz's `PoetryWorker(QThread)`
//! (`D:/Image_process/hiz/src/core/poetry.py`).
//!
//! Important: jinrishici expects a real `X-User-Token` — empty token gets
//! either a 401 or a `status != "success"` payload. We re-use the token from
//! the Python version verbatim so behaviour is identical.

use crate::error::AppResult;
use serde::Deserialize;

const ENDPOINT:    &str = "https://v2.jinrishici.com/one.json";
/// Personal token reused from hiz's `get_poetry()` (`poetry.py`).
const USER_TOKEN:  &str = "4t1UKzDyt/3zS2BVKrDLBGWTKylVgxkI";
const UA:          &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT:     &str = "少年听雨歌楼上，红烛昏罗帐";

#[derive(Deserialize)]
struct JinrishiciResponse {
    status: Option<String>,
    data:   Option<DataField>,
}
#[derive(Deserialize)]
struct DataField {
    content: Option<String>,
}

pub async fn fetch_one() -> AppResult<String> {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            tracing::warn!(%err, "reqwest client build failed");
            return Ok(DEFAULT.into());
        }
    };

    let parsed: JinrishiciResponse = match client
        .get(ENDPOINT)
        .header("X-User-Token", USER_TOKEN)
        .header("User-Agent",   UA)
        .send()
        .await
    {
        Ok(resp) => match resp.json().await {
            Ok(p) => p,
            Err(err) => {
                tracing::warn!(%err, "poetry parse failed; using default");
                return Ok(DEFAULT.into());
            }
        },
        Err(err) => {
            tracing::warn!(%err, "poetry fetch failed; using default");
            return Ok(DEFAULT.into());
        }
    };

    if parsed.status.as_deref() != Some("success") {
        tracing::warn!(?parsed.status, "poetry api returned non-success");
        return Ok(DEFAULT.into());
    }
    let content = parsed
        .data
        .and_then(|d| d.content)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT.into());
    Ok(content)
}
