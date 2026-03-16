import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { employees } from "../employee/table";
import { sharedDrives } from "../shared-drive/table";

export const folderSelections = pgTable("folder_selections", {
	id: uuid("id").defaultRandom().primaryKey(),
	employeeId: uuid("employee_id")
		.notNull()
		.references(() => employees.id, { onDelete: "cascade" }),
	folderId: text("folder_id").notNull(),
	folderName: text("folder_name").notNull(),
	sharedDriveId: uuid("shared_drive_id").references(() => sharedDrives.id, {
		onDelete: "set null",
	}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
