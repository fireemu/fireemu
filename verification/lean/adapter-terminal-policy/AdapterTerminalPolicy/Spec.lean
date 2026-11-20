import Std

namespace AT

structure Context where
  optOut : Bool
  force : Bool
  disabled : Bool
  tty : Bool
  windows : Bool
  capable : Bool

/-- Ordered color policy over the normalized environment observations. -/
def color (c : Context) : Bool :=
  !c.optOut && (c.force || (!c.disabled && c.tty && (!c.windows || c.capable)))

end AT
