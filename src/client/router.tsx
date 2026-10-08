import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { EstimatePage } from "./pages/EstimatePage";
import { EstimatesPage } from "./pages/EstimatesPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { sessionQueryOptions } from "./session";
import type { QueryClient } from "@tanstack/react-query";

function Root() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Outlet />
    </>
  );
}

function NotFound() {
  return (
    <main className="page-message" id="main">
      <div>
        <h1>That page isn’t in the book.</h1>
        <a href="/estimates">Back to estimates</a>
      </div>
    </main>
  );
}

export function createAppRouter(queryClient: QueryClient) {
  const rootRoute = createRootRoute({
    component: Root,
    notFoundComponent: NotFound,
  });

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: async () => {
      const session = await queryClient.ensureQueryData(sessionQueryOptions);
      if (session.user) throw redirect({ to: "/estimates" });
    },
    component: LoginPage,
  });

  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/register",
    beforeLoad: async () => {
      const session = await queryClient.ensureQueryData(sessionQueryOptions);
      if (session.user) throw redirect({ to: "/estimates" });
    },
    component: RegisterPage,
  });

  const estimatesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/estimates",
    beforeLoad: async () => {
      const session = await queryClient.ensureQueryData(sessionQueryOptions);
      if (!session.user) throw redirect({ to: "/" });
    },
    component: EstimatesPage,
  });

  const estimateRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/estimates/$estimateId",
    beforeLoad: async () => {
      const session = await queryClient.ensureQueryData(sessionQueryOptions);
      if (!session.user) throw redirect({ to: "/" });
    },
    component: EstimatePage,
  });

  const routeTree = rootRoute.addChildren([loginRoute, registerRoute, estimatesRoute, estimateRoute]);
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
