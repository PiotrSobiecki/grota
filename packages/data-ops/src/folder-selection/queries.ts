import { eq } from "drizzle-orm";
import { getDb } from "@/database/setup";
import type { FolderSelection, FolderSelectionCreateInput } from "./schema";
import { folderSelections } from "./table";

export async function getFolderSelectionsByEmployee(
	employeeId: string,
): Promise<FolderSelection[]> {
	const db = getDb();
	return db.select().from(folderSelections).where(eq(folderSelections.employeeId, employeeId));
}

export async function createFolderSelections(
	employeeId: string,
	selections: FolderSelectionCreateInput[],
): Promise<FolderSelection[]> {
	const db = getDb();
	const values = selections.map((s) => ({
		employeeId,
		folderId: s.folderId,
		folderName: s.folderName,
		sharedDriveId: s.sharedDriveId,
	}));
	return db.insert(folderSelections).values(values).returning();
}

export async function deleteFolderSelectionsByEmployee(employeeId: string): Promise<void> {
	const db = getDb();
	await db.delete(folderSelections).where(eq(folderSelections.employeeId, employeeId));
}
