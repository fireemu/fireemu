# Calendar clock publication

`CalendarMove.tla` models the publication decision for relative and anchored moves. The bounded instant range stands for years 0001 through 9999. A running source can tick between computing the plan and publishing it. The model checks that an accepted move publishes the exact checked instant, counts rewinds against that sample, and leaves all published state unchanged on refusal. In a separate run, set `SingleSample = FALSE` to expose the previous two-reading behavior.

Run TLC from this directory with `tla2tools -config CalendarMove.cfg CalendarMove.tla`.
