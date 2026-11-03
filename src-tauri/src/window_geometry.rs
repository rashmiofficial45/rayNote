type Frame = (f64, f64, f64, f64);

pub fn reachable_frame(frame: Frame, screens: &[Frame]) -> Frame {
    if screens.is_empty() { return frame; }
    let overlap = |screen: &Frame| {
        let width = (frame.0 + frame.2).min(screen.0 + screen.2) - frame.0.max(screen.0);
        let height = (frame.1 + frame.3).min(screen.1 + screen.3) - frame.1.max(screen.1);
        width.max(0.0) * height.max(0.0)
    };
    let screen = screens.iter().max_by(|a,b| overlap(a).total_cmp(&overlap(b))).unwrap();
    let w = frame.2.min(screen.2);
    let h = frame.3.min(screen.3);
    (frame.0.clamp(screen.0, screen.0 + screen.2 - w),
     frame.1.clamp(screen.1, screen.1 + screen.3 - h), w, h)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn valid_negative_monitor_is_preserved() {
        let frame = (-900.0, 100.0, 380.0, 600.0);
        assert_eq!(reachable_frame(frame, &[(-1200.0, 0.0, 1200.0, 900.0), (0.0, 0.0, 1440.0, 900.0)]), frame);
    }
    #[test] fn detached_display_is_recovered() {
        assert_eq!(reachable_frame((2500.0, 100.0, 380.0, 600.0), &[(0.0, 0.0, 1440.0, 900.0)]), (1060.0, 100.0, 380.0, 600.0));
    }
    #[test] fn oversized_frame_fits_current_screen() {
        assert_eq!(reachable_frame((0.0, 0.0, 2000.0, 1500.0), &[(0.0, 25.0, 1440.0, 875.0)]), (0.0, 25.0, 1440.0, 875.0));
    }
}
