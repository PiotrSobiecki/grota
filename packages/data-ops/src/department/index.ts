export {
	assignEmployeeDepartments,
	createDepartment,
	createDepartmentsBulk,
	deleteDepartment,
	getDepartmentById,
	getDepartmentsByDeployment,
	getEmployeeDepartments,
	removeEmployeeDepartment,
	updateDepartment,
} from "./queries";
export type {
	Department,
	DepartmentCreateInput,
	DepartmentListResponse,
	DepartmentUpdateInput,
} from "./schema";
export {
	DEPARTMENT_SUGGESTIONS,
	DepartmentBulkCreateRequestSchema,
	DepartmentCreateRequestSchema,
	DepartmentDeploymentParamSchema,
	DepartmentIdParamSchema,
	DepartmentListResponseSchema,
	DepartmentSchema,
	DepartmentUpdateRequestSchema,
	MAX_DEPARTMENTS_PER_DEPLOYMENT,
} from "./schema";
export { deploymentDepartments, employeeDepartments } from "./table";
