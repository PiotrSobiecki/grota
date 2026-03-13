export {
	deleteSharedDrivesByDeployment,
	getSharedDrivesByDeployment,
	upsertSharedDrives,
} from "./queries";
export type {
	SharedDrive,
	SharedDriveBulkUpsertInput,
	SharedDriveCategory,
	SharedDriveCreateInput,
	SharedDriveUpsertInput,
} from "./schema";
export {
	SharedDriveBulkUpsertRequestSchema,
	SharedDriveCategorySchema,
	SharedDriveCreateRequestSchema,
	SharedDriveDeploymentParamSchema,
	SharedDriveListResponseSchema,
	SharedDriveSchema,
	SharedDriveUpsertRequestSchema,
} from "./schema";
export { sharedDrives } from "./table";
