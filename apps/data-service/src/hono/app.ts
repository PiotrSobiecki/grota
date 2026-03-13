import { Hono } from "hono";
import cliNotifyHandlers from "./handlers/cli-notify-handlers";
import configHandlers from "./handlers/config-handlers";
import departmentHandlers from "./handlers/department-handlers";
import deployments from "./handlers/deployment-handlers";
import employeeHandlers from "./handlers/employee-handlers";
import folderHandlers from "./handlers/folder-handlers";
import health from "./handlers/health-handlers";
import magicLinkHandlers from "./handlers/magic-link-handlers";
import notificationHandlers from "./handlers/notification-handlers";
import oauthHandlers from "./handlers/oauth-handlers";
import { createCorsMiddleware } from "./middleware/cors";
import { onErrorHandler } from "./middleware/error-handler";
import { requestId } from "./middleware/request-id";

export const App = new Hono<{ Bindings: Env }>();

App.use("*", requestId());
App.onError(onErrorHandler);
App.use("*", createCorsMiddleware());

App.route("/health", health);
App.route("/config", configHandlers);
App.route("/departments", departmentHandlers);
App.route("/deployments", deployments);
App.route("/employees", employeeHandlers);
App.route("/folders", folderHandlers);
App.route("/magic-links", magicLinkHandlers);
App.route("/notifications", notificationHandlers);
App.route("/notify", cliNotifyHandlers);
App.route("/api/oauth", oauthHandlers);
