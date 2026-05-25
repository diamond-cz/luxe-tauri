//! Adaptive window geometry — Rust port of `_compute_adaptive_geometry` in
//! `hiz_main.py` (lines 84-119).
//!
//! Rules (in order):
//! 1. First launch (no saved width/height) → 1300×800.
//! 2. Saved screen matches current available area → reuse saved width/height.
//! 3. Saved screen differs (display changed or resolution change) → scale by
//!    `min(curr_w/saved_sw, curr_h/saved_sh)`.
//! 4. Clamp to `[1024×380, avail*0.95]`.
//! 5. Centre on current available area.

use serde::{Deserialize, Serialize};

pub const MIN_W: u32 = 1024;
pub const MIN_H: u32 = 380;
pub const FIRST_LAUNCH_W: u32 = 1300;
pub const FIRST_LAUNCH_H: u32 = 800;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SavedGeom {
    pub width:    u32,
    pub height:   u32,
    pub screen_w: u32,
    pub screen_h: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AvailRect {
    pub x:      i32,
    pub y:      i32,
    pub width:  u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TargetGeom {
    pub x:      i32,
    pub y:      i32,
    pub width:  u32,
    pub height: u32,
}

pub fn compute(saved: SavedGeom, avail: AvailRect) -> TargetGeom {
    let (mut target_w, mut target_h) = if saved.width == 0 || saved.height == 0 {
        (FIRST_LAUNCH_W, FIRST_LAUNCH_H)
    } else if saved.screen_w > 0
        && saved.screen_h > 0
        && (saved.screen_w, saved.screen_h) != (avail.width, avail.height)
    {
        let ratio = (avail.width as f32 / saved.screen_w as f32)
            .min(avail.height as f32 / saved.screen_h as f32);
        (
            ((saved.width  as f32) * ratio) as u32,
            ((saved.height as f32) * ratio) as u32,
        )
    } else {
        (saved.width, saved.height)
    };

    // Clamp to [min, avail * 0.95].
    let max_w = ((avail.width  as f32) * 0.95) as u32;
    let max_h = ((avail.height as f32) * 0.95) as u32;
    target_w = target_w.clamp(MIN_W, max_w.max(MIN_W));
    target_h = target_h.clamp(MIN_H, max_h.max(MIN_H));

    let x = avail.x + ((avail.width  as i32 - target_w as i32) / 2);
    let y = avail.y + ((avail.height as i32 - target_h as i32) / 2);

    TargetGeom { x, y, width: target_w, height: target_h }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(w: u32, h: u32) -> AvailRect { AvailRect { x: 0, y: 0, width: w, height: h } }

    #[test]
    fn first_launch_uses_defaults() {
        let g = compute(
            SavedGeom { width: 0, height: 0, screen_w: 0, screen_h: 0 },
            avail(1920, 1080),
        );
        assert_eq!((g.width, g.height), (1300, 800));
    }

    #[test]
    fn same_screen_reuses_saved() {
        let g = compute(
            SavedGeom { width: 1500, height: 900, screen_w: 1920, screen_h: 1080 },
            avail(1920, 1080),
        );
        assert_eq!((g.width, g.height), (1500, 900));
    }

    #[test]
    fn smaller_screen_scales_down() {
        // 1920×1080 → 1366×768, ratio = min(1366/1920, 768/1080) ≈ 0.711
        let g = compute(
            SavedGeom { width: 1500, height: 900, screen_w: 1920, screen_h: 1080 },
            avail(1366, 768),
        );
        assert!(g.width  >= MIN_W);
        assert!(g.height >= MIN_H);
        assert!(g.width  <= (1366f32 * 0.95) as u32);
        assert!(g.height <= ( 768f32 * 0.95) as u32);
    }

    #[test]
    fn always_above_min() {
        let g = compute(
            SavedGeom { width: 100, height: 100, screen_w: 4000, screen_h: 2160 },
            avail(800, 600),
        );
        assert_eq!(g.width,  MIN_W);
        assert_eq!(g.height, MIN_H);
    }

    #[test]
    fn centres_on_avail_origin() {
        let g = compute(
            SavedGeom { width: 1300, height: 800, screen_w: 1920, screen_h: 1080 },
            AvailRect { x: 100, y: 50, width: 1920, height: 1080 },
        );
        assert_eq!(g.x, 100 + (1920 - 1300) / 2);
        assert_eq!(g.y,  50 + (1080 -  800) / 2);
    }
}
