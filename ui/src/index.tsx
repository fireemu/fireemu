/* @refresh reload */
import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import "./styles.css";
import { App } from "./App";
import { UI_BASE } from "./lib/hrefs";
import { routes } from "./routes";

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Router base={UI_BASE} root={App}>
        {routes}
      </Router>
    ),
    root,
  );
}
