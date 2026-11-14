use crate::protocol::is_absolute_windows_path;
use serde::{Deserialize, Serialize};

pub fn normalize_windows_path(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ViewerSnapshot {
    pub source: String,
    pub sequence: u64,
    pub test_machine_column_path: Option<String>,
    #[serde(default)]
    pub files: Vec<String>,
    pub current_path: Option<String>,
    #[serde(default)]
    pub test_machine_files: Vec<String>,
    #[serde(default)]
    pub test_machine_current_path: Option<String>,
}

impl ViewerSnapshot {
    pub fn validate(&self) -> Result<(), &'static str> {
        for (files, current) in [
            (&self.files, &self.current_path),
            (&self.test_machine_files, &self.test_machine_current_path),
        ] {
            if files.len() > 1000
                || files
                    .iter()
                    .any(|path| path.len() > 8192 || !is_absolute_windows_path(path))
                || current.as_ref().is_some_and(|current| {
                    !files
                        .iter()
                        .any(|path| normalize_windows_path(path) == normalize_windows_path(current))
                })
            {
                return Err("invalid viewer paths");
            }
        }
        Ok(())
    }

    pub fn active_files(&self) -> &[String] {
        if self.test_machine_column_path.is_some() {
            &self.test_machine_files
        } else {
            &self.files
        }
    }

    pub fn sync_path(&self) -> Option<&str> {
        // The host maps a compare row to the test device. A null path means that
        // row has no matching test image; neither the focused pane nor row 0 is a fallback.
        if self.test_machine_column_path.is_some() {
            self.test_machine_current_path.as_deref()
        } else {
            self.current_path.as_deref()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snapshot() -> ViewerSnapshot {
        serde_json::from_value(json!({
            "source": "hiviewer-compare", "sequence": 12,
            "sourceSequence": 5, "publishedAtMicros": 123456,
            "theme": { "dark": true },
            "files": ["D:/reference/42.jpg"], "currentPath": "D:/reference/42.jpg",
            "testMachineColumnPath": "D:/device",
            "testMachineFiles": ["D:/device/41.jpg", "D:/device/42.jpg"],
            "testMachineCurrentPath": "D:/device/42.jpg"
        }))
        .unwrap()
    }

    #[test]
    fn current_host_snapshot_follows_test_device_row_instead_of_focused_reference() {
        let value = snapshot();
        assert!(value.validate().is_ok());
        assert_eq!(value.sync_path(), Some("D:/device/42.jpg"));
        assert_eq!(value.active_files().len(), 2);
    }

    #[test]
    fn missing_test_device_row_never_falls_back_to_reference_or_first_image() {
        let mut value = snapshot();
        value.test_machine_current_path = None;
        assert!(value.validate().is_ok());
        assert_eq!(value.sync_path(), None);
        value.test_machine_files.clear();
        assert!(value.active_files().is_empty());
        assert_eq!(value.sync_path(), None);
    }

    #[test]
    fn clearing_test_device_restores_main_focus_and_navigation() {
        let mut value = snapshot();
        value.test_machine_column_path = None;
        assert_eq!(value.sync_path(), Some("D:/reference/42.jpg"));
        assert_eq!(value.active_files(), value.files);
    }

    #[test]
    fn invalid_or_unlisted_paths_are_rejected() {
        let mut value = snapshot();
        value.test_machine_current_path = Some("D:/device/missing.jpg".into());
        assert!(value.validate().is_err());
        value.test_machine_current_path = None;
        value.test_machine_files.push("relative.jpg".into());
        assert!(value.validate().is_err());
    }

    #[test]
    fn windows_path_case_and_separator_variations_are_valid() {
        let mut value = snapshot();
        value.test_machine_current_path = Some(r"d:\DEVICE\42.jpg".into());
        assert!(value.validate().is_ok());
    }

    #[test]
    fn snapshot_path_count_and_length_are_bounded() {
        let mut value = snapshot();
        value.files = vec!["D:/reference/42.jpg".into(); 1001];
        assert!(value.validate().is_err());
        value.files = vec![format!("D:/{}.jpg", "x".repeat(8192))];
        value.current_path = None;
        assert!(value.validate().is_err());
    }
}
