export {
	getServerConfigAuditLog,
	recordServerConfigChange,
	type RecordServerConfigChangeInput,
} from "./queries.js";
export { ServerConfigAuditEntrySchema } from "./schema.js";
export type { ServerConfigAuditEntry } from "./schema.js";
export { serverConfigAuditLog } from "./table.js";
