/* @refresh reload */
import { render } from "@solidjs/web";
import { createRouter } from "@solidjs/router";
import "./styles.css";
import { App } from "./App";
import { UI_BASE } from "./lib/hrefs";
import { routes } from "./routes";

const Router = createRouter({ routes, base: UI_BASE });

const root = document.getElementById("root");
if (root) {
  render(() => <Router>{(props) => <App {...props} />}</Router>, root);
}
