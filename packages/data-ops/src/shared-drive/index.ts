export {
	deleteSharedDrivesByDeployment,
	getSharedDrivesByDeployment,
	upsertSharedDrives,
} from "./queries";
export type {
	SharedDrive,
	SharedDriveBulkUpsertInput,
	SharedDriveCreateInput,
	SharedDriveUpsertInput,
} from "./schema";
export {
	SharedDriveBulkUpsertRequestSchema,
	SharedDriveCreateRequestSchema,
	SharedDriveDeploymentParamSchema,
	SharedDriveListResponseSchema,
	SharedDriveSchema,
	SharedDriveUpsertRequestSchema,
} from "./schema";
export { sharedDrives } from "./table";
