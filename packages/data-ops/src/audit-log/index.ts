export {
	getServerConfigAuditLog,
	type RecordServerConfigChangeInput,
	recordServerConfigChange,
} from "./queries.js";
export type { ServerConfigAuditEntry } from "./schema.js";
export { ServerConfigAuditEntrySchema } from "./schema.js";
export { serverConfigAuditLog } from "./table.js";
