import { Hono } from "hono";
import departmentHandlers from "./handlers/department-handlers";
import deployments from "./handlers/deployment-handlers";
import employeeHandlers from "./handlers/employee-handlers";
import health from "./handlers/health-handlers";
import magicLinkHandlers from "./handlers/magic-link-handlers";
import { createCorsMiddleware } from "./middleware/cors";
import { onErrorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";

export const App = new Hono<{ Bindings: Env }>();

App.use("*", requestId());
App.onError(onErrorHandler);
App.use("*", createCorsMiddleware());

App.route("/health", health);
App.route("/departments", departmentHandlers);
App.route("/deployments", deployments);
App.route("/employees", employeeHandlers);
App.route("/magic-links", magicLinkHandlers);
