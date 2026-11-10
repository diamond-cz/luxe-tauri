//! Shared by LUXE and the native HiViewer bridge. JSONL buffers survive select! cancellation.
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub const PIPE_NAME: &str = r"\\.\pipe\luxe-image-sync-v1";
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnvelope {
    pub protocol_version: u8,
    pub kind: String,
    pub source_instance: String,
    pub sequence: u64,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub image_paths: Option<Vec<String>>,
    #[serde(default)]
    pub accepted: Option<bool>,
    #[serde(default)]
    pub reason: Option<String>,
}

pub fn is_absolute_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    if path.contains(['\0', '\r', '\n']) {
        return false;
    }
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return matches!(bytes[2], b'\\' | b'/');
    }
    path.strip_prefix(r"\\").is_some_and(|tail| {
        let parts = tail.split(['\\', '/']).collect::<Vec<_>>();
        parts.len() >= 3 && parts.iter().all(|part| !part.is_empty())
    })
}

pub fn parse_message(line: &str) -> Result<SyncEnvelope, &'static str> {
    if line.len() > MAX_MESSAGE_BYTES {
        return Err("message-too-large");
    }
    let message: SyncEnvelope = serde_json::from_str(line).map_err(|_| "invalid-json")?;
    if message.protocol_version != 1 {
        return Err("unsupported-version");
    }
    if message.source_instance.is_empty() || message.source_instance.len() > 128 {
        return Err("invalid-source-instance");
    }
    if message.sequence == 0 || message.sequence > 9_007_199_254_740_991 {
        return Err("invalid-sequence");
    }
    match message.kind.as_str() {
        "selection" => {
            if message.image_path.is_none()
                && message.image_paths.as_ref().is_none_or(Vec::is_empty)
            {
                return Err("missing-image-path");
            }
            if message
                .image_paths
                .as_ref()
                .is_some_and(|paths| paths.len() > 32)
            {
                return Err("too-many-image-paths");
            }
            if message
                .image_path
                .iter()
                .chain(message.image_paths.iter().flatten())
                .any(|path| !is_absolute_windows_path(path))
            {
                return Err("invalid-image-path");
            }
        }
        "ack" if message.accepted.is_some() => {}
        "ack" => return Err("missing-accepted"),
        _ => return Err("invalid-kind"),
    }
    Ok(message)
}

/// The caller clears `line` only after consuming a complete frame. All mutations
/// between fill_buf().await and consume() are synchronous, hence cancellation safe.
pub async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
) -> std::io::Result<usize> {
    loop {
        let chunk = reader.fill_buf().await?;
        if chunk.is_empty() {
            return if line.is_empty() {
                Ok(0)
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "truncated image sync frame",
                ))
            };
        }
        let newline = chunk.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(chunk.len(), |index| index + 1);
        if line.len() + take > MAX_MESSAGE_BYTES + 2 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "image sync message exceeded size limit",
            ));
        }
        line.extend_from_slice(&chunk[..take]);
        reader.consume(take);
        if newline.is_some() {
            let payload = line.strip_suffix(b"\n").unwrap_or(line);
            let payload = payload.strip_suffix(b"\r").unwrap_or(payload);
            if payload.len() > MAX_MESSAGE_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "image sync message exceeded size limit",
                ));
            }
            return Ok(line.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncWriteExt, BufReader};

    #[tokio::test]
    async fn cancelled_partial_frame_survives_outbound_activity() {
        let (mut writer, reader) = tokio::io::duplex(128);
        let mut reader = BufReader::new(reader);
        let mut line = Vec::new();
        writer.write_all(b"{\"image").await.unwrap();
        // Poll the read until it consumes the partial frame and yields, then cancel it.
        tokio::select! {
            biased;
            _ = read_bounded_line(&mut reader, &mut line) => panic!("incomplete frame completed"),
            _ = std::future::ready(()) => {}
        }
        assert_eq!(line, b"{\"image");
        writer
            .write_all("Path\":\"中文.jpg\"}\r\nnext\n".as_bytes())
            .await
            .unwrap();
        read_bounded_line(&mut reader, &mut line).await.unwrap();
        assert_eq!(
            String::from_utf8(std::mem::take(&mut line)).unwrap(),
            "{\"imagePath\":\"中文.jpg\"}\r\n"
        );
        read_bounded_line(&mut reader, &mut line).await.unwrap();
        assert_eq!(line, b"next\n");
    }

    #[tokio::test]
    async fn rejects_truncated_and_oversized_frames_and_accepts_crlf_limit() {
        let mut line = Vec::new();
        let mut reader = BufReader::new(&b"partial"[..]);
        assert_eq!(
            read_bounded_line(&mut reader, &mut line)
                .await
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::UnexpectedEof
        );
        let mut bytes = vec![b' '; MAX_MESSAGE_BYTES];
        bytes.extend_from_slice(b"\r\n");
        line.clear();
        read_bounded_line(&mut BufReader::new(bytes.as_slice()), &mut line)
            .await
            .unwrap();
        bytes.insert(0, b' ');
        line.clear();
        assert!(
            read_bounded_line(&mut BufReader::new(bytes.as_slice()), &mut line)
                .await
                .is_err()
        );
    }

    #[test]
    fn validates_all_candidates_and_javascript_safe_sequence() {
        let raw = r#"{"protocolVersion":1,"kind":"selection","sourceInstance":"viewer","sequence":1,"imagePath":"C:\\a.jpg","imagePaths":["relative.jpg"]}"#;
        assert_eq!(parse_message(raw), Err("invalid-image-path"));
        assert_eq!(
            parse_message(&raw.replace("\"sequence\":1", "\"sequence\":9007199254740992")),
            Err("invalid-sequence")
        );
        assert!(is_absolute_windows_path(r"\\server\share\图.jpg"));
        assert!(!is_absolute_windows_path(r"\\server"));
        assert!(!is_absolute_windows_path(r"1:\a.jpg"));
    }
}
