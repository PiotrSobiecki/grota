export {
	assignEmployeeDepartments,
	createDepartment,
	createDepartmentsBulk,
	deleteDepartment,
	getDepartmentById,
	getDepartmentsByDeployment,
	getEmployeeDepartments,
	removeEmployeeDepartment,
} from "./queries";
export type { Department, DepartmentCreateInput, DepartmentListResponse } from "./schema";
export {
	DEPARTMENT_SUGGESTIONS,
	DepartmentBulkCreateRequestSchema,
	DepartmentCreateRequestSchema,
	DepartmentDeploymentParamSchema,
	DepartmentIdParamSchema,
	DepartmentListResponseSchema,
	DepartmentSchema,
	MAX_DEPARTMENTS_PER_DEPLOYMENT,
} from "./schema";
export { deploymentDepartments, employeeDepartments } from "./table";
