import { flush } from "solid-js";
import { configure } from "@solidjs/testing-library";

// Solid 2 commits signal writes on the next microtask. A test that fires a DOM event and then
// reads the DOM expects the handler's writes to have rendered, as they did synchronously in
// Solid 1, so every fired event is followed by a flush (the same hook React Testing Library uses
// for `act`).
configure({
  eventWrapper: (dispatch) => {
    const result = dispatch();
    flush();
    return result;
  },
});
