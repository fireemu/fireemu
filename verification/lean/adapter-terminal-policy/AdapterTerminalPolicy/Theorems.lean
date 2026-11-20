import AdapterTerminalPolicy.Spec

namespace AT

theorem opt_out_wins (c : Context) (h : c.optOut = true) :
    color c = false := by simp [color, h]

theorem force_wins_after_opt_out (c : Context) (h : c.optOut = false) (f : c.force = true) :
    color c = true := by simp [color, h, f]

theorem default_windows_needs_tty_and_capability (c : Context)
    (h : c.optOut = false) (f : c.force = false) (d : c.disabled = false) (w : c.windows = true) :
    color c = (c.tty && c.capable) := by simp [color, h, f, d, w]

theorem redirected_stream_needs_force (c : Context) (h : c.tty = false) :
    color c = (!c.optOut && c.force) := by simp [color, h]

end AT
