import { MAX_DEPARTMENTS_PER_DEPLOYMENT } from "@repo/data-ops/department";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
	ArrowLeft,
	Copy,
	FolderTree,
	Info,
	Loader2,
	Mail,
	Pencil,
	Plus,
	Send,
	Trash2,
	Users,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	createDepartment,
	deleteDepartment,
	getDepartments,
	renameDepartment,
} from "@/core/functions/departments/binding";
import { getDeploymentById, updateExistingDeployment } from "@/core/functions/deployments/direct";
import {
	getEmployeesByDeployment,
	sendEmployeeMagicLinks,
} from "@/core/functions/employees/binding";
import { generateAdminMagicLink } from "@/core/functions/magic-links/binding";

export const Route = createFileRoute("/_auth/dashboard/$id/")({
	loader: ({ params }) => getDeploymentById({ data: { id: params.id } }),
	component: DeploymentDetailPage,
});

const STATUS_LABELS: Record<string, string> = {
	draft: "Szkic",
	onboarding: "Onboarding",
	employees_pending: "Oczekuje na pracownikow",
	ready: "Gotowe",
	active: "Aktywne",
};

const OAUTH_STATUS_LABELS: Record<
	string,
	{ label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
	pending: { label: "Oczekuje", variant: "secondary" },
	authorized: { label: "Autoryzowany", variant: "default" },
	failed: { label: "Blad", variant: "destructive" },
};

const SELECTION_STATUS_LABELS: Record<
	string,
	{ label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
	pending: { label: "Oczekuje", variant: "secondary" },
	in_progress: { label: "W trakcie", variant: "outline" },
	completed: { label: "Ukonczony", variant: "default" },
};

function DeploymentDetailPage() {
	const deployment = Route.useLoaderData();
	const router = useRouter();

	const magicLinkMutation = useMutation({
		mutationFn: () => generateAdminMagicLink({ data: { deploymentId: deployment.id } }),
		onSuccess: () => {
			router.invalidate();
		},
	});

	const handleCopyLink = async () => {
		const url = magicLinkMutation.data?.url;
		if (!url) return;
		const fullUrl = `${window.location.origin}${url}`;
		await navigator.clipboard.writeText(fullUrl);
	};

	const showEmployeeSection = deployment.status !== "draft" && deployment.status !== "onboarding";

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" asChild>
						<Link to="/dashboard">
							<ArrowLeft className="h-4 w-4 text-foreground" />
						</Link>
					</Button>
					<h1 className="text-2xl font-bold text-foreground">{deployment.clientName}</h1>
				</div>
				<div className="flex items-center gap-3">
					{(deployment.status === "ready" || deployment.status === "active") && (
						<Button asChild variant="outline">
							<Link to="/dashboard/$id/config" params={{ id: deployment.id }}>
								{deployment.status === "active" ? "Zobacz konfiguracje" : "Eksportuj konfiguracje"}
							</Link>
						</Button>
					)}
					<Badge>{STATUS_LABELS[deployment.status] ?? deployment.status}</Badge>
				</div>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<ClientDataCard deployment={deployment} onUpdated={() => router.invalidate()} />

				<MagicLinkCard
					deployment={deployment}
					magicLinkMutation={magicLinkMutation}
					onCopyLink={handleCopyLink}
				/>
			</div>

			<DepartmentSection deploymentId={deployment.id} deploymentStatus={deployment.status} />

			{showEmployeeSection && (
				<EmployeeSection deploymentId={deployment.id} deploymentStatus={deployment.status} />
			)}
		</div>
	);
}

interface ClientDataField {
	label: string;
	key: "domain" | "adminName" | "adminEmail";
	value: string;
}

interface ClientDataCardProps {
	deployment: {
		id: string;
		domain: string;
		adminName: string | null;
		adminEmail: string | null;
		status: string;
	};
	onUpdated: () => void;
}

function ClientDataCard({ deployment, onUpdated }: ClientDataCardProps) {
	const [editingField, setEditingField] = useState<ClientDataField | null>(null);
	const [editValue, setEditValue] = useState("");

	const canEdit = deployment.status === "draft" || deployment.status === "onboarding";

	const updateMutation = useMutation({
		mutationFn: (updates: { domain?: string; adminName?: string; adminEmail?: string }) =>
			updateExistingDeployment({ data: { id: deployment.id, updates } }),
		onSuccess: () => {
			onUpdated();
			setEditingField(null);
		},
	});

	const startEdit = (field: ClientDataField) => {
		setEditingField(field);
		setEditValue(field.value);
	};

	const submitEdit = () => {
		if (!editingField) return;
		const trimmed = editValue.trim();
		if (!trimmed || trimmed === editingField.value) {
			setEditingField(null);
			return;
		}
		updateMutation.mutate({ [editingField.key]: trimmed });
	};

	const renderField = (label: string, key: ClientDataField["key"], value: string | null) => {
		const displayValue = value ?? "";
		if (!displayValue && !canEdit) return null;
		const isEditing = editingField?.key === key;

		return (
			<div className="flex items-center gap-2">
				<span className="text-sm text-muted-foreground">{label}: </span>
				{isEditing ? (
					<Input
						autoFocus
						value={editValue}
						onChange={(e) => setEditValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								submitEdit();
							}
							if (e.key === "Escape") setEditingField(null);
						}}
						onBlur={submitEdit}
						disabled={updateMutation.isPending}
						className="h-7 w-48 text-sm"
					/>
				) : (
					<>
						<span className="text-foreground">{displayValue || "—"}</span>
						{canEdit && (
							<button
								type="button"
								onClick={() => startEdit({ label, key, value: displayValue })}
								className="text-muted-foreground hover:text-foreground"
							>
								<Pencil className="h-3 w-3" />
							</button>
						)}
					</>
				)}
			</div>
		);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Dane klienta</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				{updateMutation.isError && (
					<p className="text-sm text-destructive">{updateMutation.error.message}</p>
				)}
				{renderField("Domena", "domain", deployment.domain)}
				{renderField("Administrator", "adminName", deployment.adminName)}
				{renderField("Email", "adminEmail", deployment.adminEmail)}
			</CardContent>
		</Card>
	);
}

interface MagicLinkCardProps {
	deployment: {
		adminEmail: string | null;
		status: string;
		createdAt: string | Date;
	};
	magicLinkMutation: ReturnType<typeof useMutation<{ token: string; url: string }, Error, void>>;
	onCopyLink: () => void;
}

function MagicLinkCard({ deployment, magicLinkMutation, onCopyLink }: MagicLinkCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Status wdrozenia</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Utworzone: {new Date(deployment.createdAt).toLocaleDateString("pl-PL")}
				</p>

				{deployment.adminEmail && (
					<div className="space-y-3">
						{deployment.status !== "draft" && !magicLinkMutation.data?.url && (
							<p className="text-sm text-muted-foreground">
								Link onboardingowy zostal juz wyslany na {deployment.adminEmail}
							</p>
						)}

						<div className="flex items-center gap-2">
							<Button
								onClick={() => magicLinkMutation.mutate()}
								disabled={magicLinkMutation.isPending || deployment.status === "active"}
								variant={deployment.status !== "draft" ? "outline" : "default"}
							>
								{magicLinkMutation.isPending ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Generowanie...
									</>
								) : (
									<>
										<Send className="mr-2 h-4 w-4" />
										{deployment.status === "draft" ? "Generuj i wyslij link" : "Wyslij ponownie"}
									</>
								)}
							</Button>
							<Tooltip>
								<TooltipTrigger asChild>
									<Info className="h-4 w-4 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent>
									Wygenerowany link do uzupelnienia danych firmowych zostanie wyslany na adres
									administratora tego wdrozenia.
								</TooltipContent>
							</Tooltip>
						</div>

						{magicLinkMutation.isError && (
							<p className="text-sm text-destructive">{magicLinkMutation.error.message}</p>
						)}

						{magicLinkMutation.data?.url && (
							<div className="flex items-center gap-2 rounded-md border border-border bg-muted p-3">
								<code className="flex-1 text-sm text-foreground break-all">
									{magicLinkMutation.data.url}
								</code>
								<Button variant="ghost" size="icon" onClick={onCopyLink} title="Kopiuj link">
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

interface EditingDept {
	id: string;
	name: string;
}

function DepartmentSection({
	deploymentId,
	deploymentStatus,
}: {
	deploymentId: string;
	deploymentStatus: string;
}) {
	const [newDeptName, setNewDeptName] = useState("");
	const [editing, setEditing] = useState<EditingDept | null>(null);

	const departmentsQuery = useQuery({
		queryKey: ["departments", deploymentId],
		queryFn: () => getDepartments({ data: { deploymentId } }),
	});

	const createMutation = useMutation({
		mutationFn: (name: string) => createDepartment({ data: { deploymentId, name } }),
		onSuccess: () => {
			departmentsQuery.refetch();
			setNewDeptName("");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (departmentId: string) => deleteDepartment({ data: { departmentId } }),
		onSuccess: () => {
			departmentsQuery.refetch();
		},
	});

	const renameMutation = useMutation({
		mutationFn: ({ departmentId, name }: { departmentId: string; name: string }) =>
			renameDepartment({ data: { departmentId, name } }),
		onSuccess: () => {
			departmentsQuery.refetch();
			setEditing(null);
		},
	});

	const departments = departmentsQuery.data?.data ?? [];
	const canEdit = deploymentStatus === "draft" || deploymentStatus === "onboarding";
	const atLimit = departments.length >= MAX_DEPARTMENTS_PER_DEPLOYMENT;

	const handleAdd = () => {
		const trimmed = newDeptName.trim();
		if (!trimmed) return;
		createMutation.mutate(trimmed);
	};

	const handleRenameSubmit = (departmentId: string, originalName: string) => {
		const trimmed = editing?.name.trim() ?? "";
		if (trimmed && trimmed !== originalName) {
			renameMutation.mutate({ departmentId, name: trimmed });
		} else {
			setEditing(null);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<FolderTree className="h-5 w-5" />
					Dzialy wdrozenia
					<span className="text-sm font-normal text-muted-foreground">
						({departments.length}/{MAX_DEPARTMENTS_PER_DEPLOYMENT})
					</span>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{createMutation.isError && (
					<p className="text-sm text-destructive">{createMutation.error.message}</p>
				)}
				{deleteMutation.isError && (
					<p className="text-sm text-destructive">{deleteMutation.error.message}</p>
				)}
				{renameMutation.isError && (
					<p className="text-sm text-destructive">{renameMutation.error.message}</p>
				)}

				{departmentsQuery.isPending ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Ladowanie dzialow...
					</div>
				) : departments.length === 0 ? (
					<p className="text-muted-foreground">Brak dzialow.</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{departments.map((dept) => (
							<span
								key={dept.id}
								className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-sm text-foreground"
							>
								{editing?.id === dept.id ? (
									<Input
										autoFocus
										value={editing.name}
										onChange={(e) => setEditing({ id: dept.id, name: e.target.value })}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												handleRenameSubmit(dept.id, dept.name);
											}
											if (e.key === "Escape") setEditing(null);
										}}
										onBlur={() => handleRenameSubmit(dept.id, dept.name)}
										disabled={renameMutation.isPending}
										className="h-7 w-32 text-sm"
									/>
								) : canEdit ? (
									<button
										type="button"
										onClick={() => setEditing({ id: dept.id, name: dept.name })}
										className="cursor-pointer hover:underline"
									>
										{dept.name}
									</button>
								) : (
									<span>{dept.name}</span>
								)}
								{canEdit && editing?.id !== dept.id && (
									<button
										type="button"
										onClick={() => deleteMutation.mutate(dept.id)}
										disabled={deleteMutation.isPending}
										className="text-muted-foreground hover:text-destructive"
										title="Usun dzial"
									>
										<Trash2 className="h-3 w-3" />
									</button>
								)}
							</span>
						))}
					</div>
				)}

				{canEdit && (
					<div className="flex gap-2">
						<Input
							placeholder={atLimit ? "Osiagnieto limit dzialow" : "Nowy dzial..."}
							disabled={atLimit}
							value={newDeptName}
							onChange={(e) => setNewDeptName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									handleAdd();
								}
							}}
						/>
						<Tooltip>
							<TooltipTrigger asChild>
								<span tabIndex={atLimit ? 0 : undefined}>
									<Button
										variant="outline"
										size="icon"
										onClick={handleAdd}
										disabled={atLimit || createMutation.isPending}
									>
										<Plus className="h-4 w-4" />
									</Button>
								</span>
							</TooltipTrigger>
							{atLimit && (
								<TooltipContent>
									Maksymalnie {MAX_DEPARTMENTS_PER_DEPLOYMENT} dzialow na wdrozenie
								</TooltipContent>
							)}
						</Tooltip>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function EmployeeSection({
	deploymentId,
	deploymentStatus,
}: {
	deploymentId: string;
	deploymentStatus: string;
}) {
	const employeesQuery = useQuery({
		queryKey: ["employees", deploymentId],
		queryFn: () => getEmployeesByDeployment({ data: { deploymentId } }),
	});

	const sendLinksMutation = useMutation({
		mutationFn: () => sendEmployeeMagicLinks({ data: { deploymentId } }),
	});

	const employees = employeesQuery.data?.data ?? [];
	const employeeTotal = employeesQuery.data?.total ?? 0;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2">
						<Users className="h-5 w-5" />
						Pracownicy
						{employeeTotal > 0 && (
							<span className="text-sm font-normal text-muted-foreground">
								({employeeTotal} pracownikow)
							</span>
						)}
					</CardTitle>
					<Button
						variant="outline"
						onClick={() => sendLinksMutation.mutate()}
						disabled={
							sendLinksMutation.isPending || employeeTotal === 0 || deploymentStatus === "active"
						}
					>
						{sendLinksMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Wysylanie...
							</>
						) : (
							<>
								<Mail className="mr-2 h-4 w-4" />
								Wyslij linki pracownikom
							</>
						)}
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{sendLinksMutation.isError && (
					<p className="mb-3 text-sm text-destructive">{sendLinksMutation.error.message}</p>
				)}

				{sendLinksMutation.isSuccess && (
					<p className="mb-3 text-sm text-primary">
						Wyslano linki do {sendLinksMutation.data.sent} pracownikow.
					</p>
				)}

				<EmployeeList employees={employees} isPending={employeesQuery.isPending} />
			</CardContent>
		</Card>
	);
}

interface EmployeeListItem {
	id: string;
	name: string;
	email: string;
	oauthStatus: string;
	selectionStatus: string;
	departments: Array<{ id: string; name: string; slug: string }>;
}

function EmployeeList({
	employees,
	isPending,
}: {
	employees: EmployeeListItem[];
	isPending: boolean;
}) {
	if (isPending) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				Ladowanie pracownikow...
			</div>
		);
	}

	if (employees.length === 0) {
		return <p className="text-muted-foreground">Brak pracownikow.</p>;
	}

	const completedCount = employees.filter((e) => e.selectionStatus === "completed").length;

	return (
		<div className="space-y-3">
			{employees.length > 0 && (
				<p className="text-sm text-muted-foreground">
					{completedCount}/{employees.length} pracownikow ukonczylo
				</p>
			)}
			<div className="space-y-2">
				{employees.map((employee) => {
					const oauthInfo = OAUTH_STATUS_LABELS[employee.oauthStatus] ?? {
						label: employee.oauthStatus,
						variant: "outline" as const,
					};
					const selectionInfo = SELECTION_STATUS_LABELS[employee.selectionStatus] ?? {
						label: employee.selectionStatus,
						variant: "outline" as const,
					};
					const deptNames = employee.departments.map((d) => d.name).join(", ");
					return (
						<div
							key={employee.id}
							className="flex items-center justify-between rounded-md border border-border p-3"
						>
							<div>
								<p className="text-sm font-medium text-foreground">{employee.name}</p>
								<p className="text-xs text-muted-foreground">{employee.email}</p>
								{deptNames && <p className="mt-0.5 text-xs text-muted-foreground">{deptNames}</p>}
							</div>
							<div className="flex gap-2">
								<Badge variant={oauthInfo.variant}>{oauthInfo.label}</Badge>
								<Badge variant={selectionInfo.variant}>{selectionInfo.label}</Badge>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
