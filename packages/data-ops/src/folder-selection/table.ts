import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { employees } from "../employee/table";
import { sharedDrives } from "../shared-drive/table";

export const itemTypeEnum = pgEnum("item_type", ["folder", "file"]);

export const folderSelections = pgTable("folder_selections", {
	id: uuid("id").defaultRandom().primaryKey(),
	employeeId: uuid("employee_id")
		.notNull()
		.references(() => employees.id, { onDelete: "cascade" }),
	itemId: text("item_id").notNull(),
	itemName: text("item_name").notNull(),
	itemType: itemTypeEnum("item_type").notNull().default("folder"),
	parentFolderId: text("parent_folder_id"),
	mimeType: text("mime_type"),
	sharedDriveId: uuid("shared_drive_id").references(() => sharedDrives.id, {
		onDelete: "set null",
	}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
