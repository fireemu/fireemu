import {
  createRouter,
  type RouteDefinition,
  type RouterHistory,
  type RouteSectionProps,
} from "@solidjs/router";
import type { Component } from "solid-js";

/**
 * A render function for `@solidjs/testing-library` that mounts `routes` under a Router 2
 * instance: browser history unless `history` is given (`memoryHistory()` for an isolated URL),
 * and `root` as the layout around the matched route.
 */
export const routed =
  (
    routes: RouteDefinition[],
    options: { history?: RouterHistory; root?: Component<RouteSectionProps>; base?: string } = {},
  ) =>
  () => {
    const Router = createRouter({
      routes,
      ...(options.history ? { history: options.history } : {}),
      ...(options.base ? { base: options.base } : {}),
    });
    const Root = options.root;
    return <Router>{(props) => (Root ? <Root {...props} /> : props.children)}</Router>;
  };
