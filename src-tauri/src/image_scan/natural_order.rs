use std::cmp::Ordering;

/// Compare digit runs by numeric value without parsing into a fixed-size integer.
/// Equal numbers (including leading zeros) continue with the rest of the name.
pub(super) fn compare_names(left: &str, right: &str) -> Ordering {
    let (mut a, mut b) = (left.as_bytes(), right.as_bytes());
    while let (Some(&ac), Some(&bc)) = (a.first(), b.first()) {
        if ac.is_ascii_digit() && bc.is_ascii_digit() {
            let a_end = a.iter().position(|c| !c.is_ascii_digit()).unwrap_or(a.len());
            let b_end = b.iter().position(|c| !c.is_ascii_digit()).unwrap_or(b.len());
            let a_start = a[..a_end].iter().position(|&c| c != b'0').unwrap_or(a_end);
            let b_start = b[..b_end].iter().position(|&c| c != b'0').unwrap_or(b_end);
            let a_number = &a[a_start..a_end];
            let b_number = &b[b_start..b_end];
            let order = a_number.len().cmp(&b_number.len())
                .then_with(|| a_number.cmp(b_number));
            if order != Ordering::Equal {
                return order;
            }
            a = &a[a_end..];
            b = &b[b_end..];
        } else {
            let order = ac.to_ascii_lowercase().cmp(&bc.to_ascii_lowercase());
            if order != Ordering::Equal {
                return order;
            }
            a = &a[1..];
            b = &b[1..];
        }
    }
    a.len().cmp(&b.len()).then_with(|| left.cmp(right))
}
