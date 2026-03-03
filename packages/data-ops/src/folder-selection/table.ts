import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { employees } from "../employee/table";

export const folderCategoryEnum = pgEnum("folder_category", [
	"dokumenty",
	"projekty",
	"media",
	"prywatne",
]);

export const folderSelections = pgTable("folder_selections", {
	id: uuid("id").defaultRandom().primaryKey(),
	employeeId: uuid("employee_id")
		.notNull()
		.references(() => employees.id, { onDelete: "cascade" }),
	folderId: text("folder_id").notNull(),
	folderName: text("folder_name").notNull(),
	category: folderCategoryEnum("category").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
