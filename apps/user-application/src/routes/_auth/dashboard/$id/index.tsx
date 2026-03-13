import { MAX_DEPARTMENTS_PER_DEPLOYMENT } from "@repo/data-ops/department";
import type { B2Config, ServerConfig } from "@repo/data-ops/deployment";
import { slugify } from "@repo/data-ops/utils";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
	ArrowLeft,
	Bell,
	ChevronDown,
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
	X,
} from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	createDepartment,
	deleteDepartment,
	getDepartments,
	renameDepartment,
} from "@/core/functions/departments/binding";
import {
	getDeploymentById,
	markDeploymentReady,
	updateExistingDeployment,
} from "@/core/functions/deployments/direct";
import {
	getEmployeesByDeployment,
	sendEmployeeMagicLinks,
} from "@/core/functions/employees/binding";
import { generateAdminMagicLink } from "@/core/functions/magic-links/binding";
import { sendNotifications } from "@/core/functions/notifications/binding";
import { cn } from "@/lib/utils";

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
	const isActive = deployment.status === "active";

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
					{isActive && <DetailNotificationButton deploymentId={deployment.id} />}
					{(deployment.status === "ready" || isActive) && (
						<Button asChild variant="outline">
							<Link to="/dashboard/$id/config" params={{ id: deployment.id }}>
								{isActive ? "Zobacz konfiguracje" : "Eksportuj konfiguracje"}
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

			<ServerConfigCard deployment={deployment} onUpdated={() => router.invalidate()} />

			<DepartmentSection deploymentId={deployment.id} deploymentStatus={deployment.status} />

			{showEmployeeSection && (
				<EmployeeSection
					deploymentId={deployment.id}
					deploymentStatus={deployment.status}
					onStatusChanged={() => router.invalidate()}
				/>
			)}
		</div>
	);
}

interface DetailNotificationButtonProps {
	deploymentId: string;
}

function DetailNotificationButton({ deploymentId }: DetailNotificationButtonProps) {
	const [open, setOpen] = useState(false);

	const notifyMutation = useMutation({
		mutationFn: () => sendNotifications({ data: { deploymentId } }),
	});

	const handleConfirm = () => {
		setOpen(false);
		notifyMutation.reset();
		notifyMutation.mutate();
	};

	return (
		<>
			{notifyMutation.isSuccess && (
				<p className="text-sm text-primary">
					Telegram: {notifyMutation.data.telegram ? "OK" : "blad"}, Email:{" "}
					{notifyMutation.data.email ? "OK" : "pominiety"}
				</p>
			)}
			{notifyMutation.isError && (
				<p className="text-sm text-destructive">{notifyMutation.error.message}</p>
			)}
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogTrigger asChild>
					<Button variant="outline" disabled={notifyMutation.isPending}>
						{notifyMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Wysylanie...
							</>
						) : (
							<>
								<Bell className="mr-2 h-4 w-4" />
								Wyslij powiadomienia
							</>
						)}
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Wyslij powiadomienia</AlertDialogTitle>
						<AlertDialogDescription>
							Telegram i email zostana wyslane do administratora wdrozenia. Kontynuowac?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Anuluj</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirm}>Wyslij</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

interface ClientDataCardProps {
	deployment: {
		id: string;
		clientName: string;
		domain: string;
		adminName: string | null;
		adminEmail: string | null;
		status: string;
	};
	onUpdated: () => void;
}

function ClientDataCard({ deployment, onUpdated }: ClientDataCardProps) {
	const [isEditing, setIsEditing] = useState(false);

	const updateMutation = useMutation({
		mutationFn: (updates: {
			clientName?: string;
			domain?: string;
			adminName?: string;
			adminEmail?: string;
		}) => updateExistingDeployment({ data: { id: deployment.id, updates } }),
		onSuccess: () => {
			onUpdated();
			setIsEditing(false);
		},
	});

	const form = useForm({
		defaultValues: {
			clientName: deployment.clientName,
			domain: deployment.domain,
			adminName: deployment.adminName ?? "",
			adminEmail: deployment.adminEmail ?? "",
		},
		onSubmit: async ({ value }) => {
			const updates: Record<string, string> = {};
			if (value.clientName !== deployment.clientName) updates.clientName = value.clientName;
			if (value.domain !== deployment.domain) updates.domain = value.domain;
			if (value.adminName !== (deployment.adminName ?? "")) updates.adminName = value.adminName;
			if (value.adminEmail !== (deployment.adminEmail ?? "")) updates.adminEmail = value.adminEmail;

			if (Object.keys(updates).length === 0) {
				setIsEditing(false);
				return;
			}
			updateMutation.reset();
			updateMutation.mutate(updates);
		},
	});

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>Dane klienta</CardTitle>
					{isEditing ? (
						<Button
							variant="ghost"
							size="icon"
							onClick={() => {
								setIsEditing(false);
								form.reset();
							}}
						>
							<X className="h-4 w-4" />
						</Button>
					) : (
						<Button variant="ghost" size="icon" onClick={() => setIsEditing(true)}>
							<Pencil className="h-4 w-4" />
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-2">
				{updateMutation.isError && (
					<p className="text-sm text-destructive">{updateMutation.error.message}</p>
				)}
				{isEditing ? (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-3"
					>
						<form.Field name="clientName">
							{(field) => (
								<div>
									<label className="text-sm text-muted-foreground">Nazwa klienta</label>
									<Input
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										className="h-8"
									/>
								</div>
							)}
						</form.Field>
						<form.Field name="domain">
							{(field) => (
								<div>
									<label className="text-sm text-muted-foreground">Domena</label>
									<Input
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										className="h-8"
									/>
								</div>
							)}
						</form.Field>
						<form.Field name="adminName">
							{(field) => (
								<div>
									<label className="text-sm text-muted-foreground">Administrator</label>
									<Input
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										className="h-8"
									/>
								</div>
							)}
						</form.Field>
						<form.Field name="adminEmail">
							{(field) => (
								<div>
									<label className="text-sm text-muted-foreground">Email</label>
									<Input
										type="email"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										className="h-8"
									/>
								</div>
							)}
						</form.Field>
						<form.Subscribe selector={(s) => s.canSubmit}>
							{(canSubmit) => (
								<Button type="submit" size="sm" disabled={!canSubmit || updateMutation.isPending}>
									{updateMutation.isPending ? "Zapisywanie..." : "Zapisz"}
								</Button>
							)}
						</form.Subscribe>
					</form>
				) : (
					<>
						<div className="text-sm">
							<span className="text-muted-foreground">Nazwa: </span>
							<span className="text-foreground">{deployment.clientName}</span>
						</div>
						<div className="text-sm">
							<span className="text-muted-foreground">Domena: </span>
							<span className="text-foreground">{deployment.domain}</span>
						</div>
						<div className="text-sm">
							<span className="text-muted-foreground">Administrator: </span>
							<span className="text-foreground">{deployment.adminName ?? "—"}</span>
						</div>
						<div className="text-sm">
							<span className="text-muted-foreground">Email: </span>
							<span className="text-foreground">{deployment.adminEmail ?? "—"}</span>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

interface ServerConfigCardProps {
	deployment: {
		id: string;
		clientName: string;
		b2Config: B2Config | null;
		serverConfig: ServerConfig | null;
	};
	onUpdated: () => void;
}

function ServerConfigCard({ deployment, onUpdated }: ServerConfigCardProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(!!deployment.serverConfig);

	const updateMutation = useMutation({
		mutationFn: (updates: { b2Config?: B2Config; serverConfig?: ServerConfig }) =>
			updateExistingDeployment({ data: { id: deployment.id, updates } }),
		onSuccess: () => {
			onUpdated();
			setIsEditing(false);
		},
	});

	const form = useForm({
		defaultValues: {
			b2KeyId: deployment.b2Config?.key_id ?? "",
			b2AppKey: deployment.b2Config?.app_key ?? "",
			b2BucketPrefix: deployment.b2Config?.bucket_prefix ?? slugify(deployment.clientName),
			backupPath: deployment.serverConfig?.backup_path ?? "",
			bwlimit: deployment.serverConfig?.bwlimit ?? "",
			sshHost: deployment.serverConfig?.ssh_host ?? "",
			sshUser: deployment.serverConfig?.ssh_user ?? "",
		},
		onSubmit: async ({ value }) => {
			const updates: { b2Config?: B2Config; serverConfig?: ServerConfig } = {};

			if (value.b2KeyId || value.b2AppKey || value.b2BucketPrefix) {
				updates.b2Config = {
					key_id: value.b2KeyId,
					app_key: value.b2AppKey,
					bucket_prefix: value.b2BucketPrefix,
				};
			}

			if (value.backupPath || value.bwlimit) {
				updates.serverConfig = {
					backup_path: value.backupPath,
					bwlimit: value.bwlimit,
					...(value.sshHost ? { ssh_host: value.sshHost } : {}),
					...(value.sshUser ? { ssh_user: value.sshUser } : {}),
				};
			}

			if (!updates.b2Config && !updates.serverConfig) {
				setIsEditing(false);
				return;
			}

			updateMutation.reset();
			updateMutation.mutate(updates);
		},
	});

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>Konfiguracja serwera</CardTitle>
					{isEditing ? (
						<Button
							variant="ghost"
							size="icon"
							onClick={() => {
								setIsEditing(false);
								form.reset();
							}}
						>
							<X className="h-4 w-4" />
						</Button>
					) : (
						<Button variant="ghost" size="icon" onClick={() => setIsEditing(true)}>
							<Pencil className="h-4 w-4" />
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{updateMutation.isError && (
					<p className="text-sm text-destructive">{updateMutation.error.message}</p>
				)}
				{isEditing ? (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-4"
					>
						<div className="space-y-3">
							<p className="text-sm font-medium text-foreground">B2 Config</p>
							<form.Field name="b2KeyId">
								{(field) => (
									<div>
										<label className="text-sm text-muted-foreground flex items-center gap-1">
											Key ID
											<Tooltip>
												<TooltipTrigger asChild>
													<Info className="h-3 w-3 cursor-help" />
												</TooltipTrigger>
												<TooltipContent>
													{
														"Identyfikator klucza B2 (Backblaze). Znajdziesz go w panelu B2 > App Keys."
													}
												</TooltipContent>
											</Tooltip>
										</label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											className="h-8"
										/>
									</div>
								)}
							</form.Field>
							<form.Field name="b2AppKey">
								{(field) => (
									<div>
										<label className="text-sm text-muted-foreground flex items-center gap-1">
											App Key
											<Tooltip>
												<TooltipTrigger asChild>
													<Info className="h-3 w-3 cursor-help" />
												</TooltipTrigger>
												<TooltipContent>
													Tajny klucz aplikacji B2. Widoczny tylko przy tworzeniu — zapisz go od
													razu.
												</TooltipContent>
											</Tooltip>
										</label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											className="h-8"
										/>
									</div>
								)}
							</form.Field>
							<form.Field name="b2BucketPrefix">
								{(field) => (
									<div>
										<label className="text-sm text-muted-foreground flex items-center gap-1">
											Bucket Prefix
											<Tooltip>
												<TooltipTrigger asChild>
													<Info className="h-3 w-3 cursor-help" />
												</TooltipTrigger>
												<TooltipContent>
													Prefix nazwy bucketa B2. Bucket zostanie utworzony jako prefix-backup,
													prefix-audit itp.
												</TooltipContent>
											</Tooltip>
										</label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											className="h-8"
										/>
									</div>
								)}
							</form.Field>
						</div>

						<Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
							<CollapsibleTrigger asChild>
								<Button variant="ghost" size="sm" type="button" className="gap-1">
									<ChevronDown
										className={cn("h-4 w-4 transition-transform", showAdvanced && "rotate-180")}
									/>
									Zaawansowane
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent className="space-y-3 pt-2">
								<form.Field name="backupPath">
									{(field) => (
										<div>
											<label className="text-sm text-muted-foreground flex items-center gap-1">
												Backup Path
												<Tooltip>
													<TooltipTrigger asChild>
														<Info className="h-3 w-3 cursor-help" />
													</TooltipTrigger>
													<TooltipContent>
														Sciezka na serwerze, gdzie rclone zapisuje kopie plikow z Google Drive.
													</TooltipContent>
												</Tooltip>
											</label>
											<Input
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												className="h-8"
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="bwlimit">
									{(field) => (
										<div>
											<label className="text-sm text-muted-foreground flex items-center gap-1">
												Bandwidth Limit
												<Tooltip>
													<TooltipTrigger asChild>
														<Info className="h-3 w-3 cursor-help" />
													</TooltipTrigger>
													<TooltipContent>
														Limit transferu rclone, np. 08:00,5M 23:00,50M (5 MB/s w dzien, 50 MB/s
														w nocy).
													</TooltipContent>
												</Tooltip>
											</label>
											<Input
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												className="h-8"
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="sshHost">
									{(field) => (
										<div>
											<label className="text-sm text-muted-foreground flex items-center gap-1">
												SSH Host (opcjonalny)
												<Tooltip>
													<TooltipTrigger asChild>
														<Info className="h-3 w-3 cursor-help" />
													</TooltipTrigger>
													<TooltipContent>
														Adres serwera do zdalnego dostepu, np. 192.168.1.10 lub serwer.firma.pl.
													</TooltipContent>
												</Tooltip>
											</label>
											<Input
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												className="h-8"
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="sshUser">
									{(field) => (
										<div>
											<label className="text-sm text-muted-foreground flex items-center gap-1">
												SSH User (opcjonalny)
												<Tooltip>
													<TooltipTrigger asChild>
														<Info className="h-3 w-3 cursor-help" />
													</TooltipTrigger>
													<TooltipContent>
														Uzytkownik SSH na serwerze docelowym, np. backup lub root.
													</TooltipContent>
												</Tooltip>
											</label>
											<Input
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												className="h-8"
											/>
										</div>
									)}
								</form.Field>
							</CollapsibleContent>
						</Collapsible>

						<form.Subscribe selector={(s) => s.canSubmit}>
							{(canSubmit) => (
								<Button type="submit" size="sm" disabled={!canSubmit || updateMutation.isPending}>
									{updateMutation.isPending ? "Zapisywanie..." : "Zapisz"}
								</Button>
							)}
						</form.Subscribe>
					</form>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<p className="text-sm font-medium text-foreground">B2 Config</p>
							{deployment.b2Config ? (
								<>
									<div className="text-sm">
										<span className="text-muted-foreground">Key ID: </span>
										<span className="text-foreground">{deployment.b2Config.key_id}</span>
									</div>
									<div className="text-sm">
										<span className="text-muted-foreground">App Key: </span>
										<span className="text-foreground">{"*".repeat(8)}</span>
									</div>
									<div className="text-sm">
										<span className="text-muted-foreground">Bucket Prefix: </span>
										<span className="text-foreground">{deployment.b2Config.bucket_prefix}</span>
									</div>
								</>
							) : (
								<p className="text-sm text-muted-foreground">Nie skonfigurowano</p>
							)}
						</div>
						<Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
							<CollapsibleTrigger asChild>
								<Button variant="ghost" size="sm" type="button" className="gap-1">
									<ChevronDown
										className={cn("h-4 w-4 transition-transform", showAdvanced && "rotate-180")}
									/>
									Zaawansowane
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent className="space-y-2 pt-2">
								{deployment.serverConfig ? (
									<>
										<div className="text-sm">
											<span className="text-muted-foreground">Backup Path: </span>
											<span className="text-foreground">{deployment.serverConfig.backup_path}</span>
										</div>
										<div className="text-sm">
											<span className="text-muted-foreground">BW Limit: </span>
											<span className="text-foreground">{deployment.serverConfig.bwlimit}</span>
										</div>
										{deployment.serverConfig.ssh_host && (
											<div className="text-sm">
												<span className="text-muted-foreground">SSH Host: </span>
												<span className="text-foreground">{deployment.serverConfig.ssh_host}</span>
											</div>
										)}
										{deployment.serverConfig.ssh_user && (
											<div className="text-sm">
												<span className="text-muted-foreground">SSH User: </span>
												<span className="text-foreground">{deployment.serverConfig.ssh_user}</span>
											</div>
										)}
									</>
								) : (
									<p className="text-sm text-muted-foreground">Nie skonfigurowano</p>
								)}
							</CollapsibleContent>
						</Collapsible>
					</div>
				)}
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
	onStatusChanged,
}: {
	deploymentId: string;
	deploymentStatus: string;
	onStatusChanged: () => void;
}) {
	const [readyDialogOpen, setReadyDialogOpen] = useState(false);

	const employeesQuery = useQuery({
		queryKey: ["employees", deploymentId],
		queryFn: () => getEmployeesByDeployment({ data: { deploymentId } }),
	});

	const sendLinksMutation = useMutation({
		mutationFn: () => sendEmployeeMagicLinks({ data: { deploymentId } }),
	});

	const readyMutation = useMutation({
		mutationFn: () => markDeploymentReady({ data: { id: deploymentId } }),
		onSuccess: () => {
			setReadyDialogOpen(false);
			onStatusChanged();
		},
	});

	const employees = employeesQuery.data?.data ?? [];
	const employeeTotal = employeesQuery.data?.total ?? 0;
	const completedCount = employees.filter((e) => e.selectionStatus === "completed").length;
	const canMarkReady = deploymentStatus === "employees_pending" && completedCount > 0;

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
					<div className="flex gap-2">
						{canMarkReady && (
							<AlertDialog open={readyDialogOpen} onOpenChange={setReadyDialogOpen}>
								<AlertDialogTrigger asChild>
									<Button variant="default">Oznacz jako gotowe</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Oznacz wdrozenie jako gotowe?</AlertDialogTitle>
										<AlertDialogDescription>
											{completedCount}/{employeeTotal} pracownikow ukonczylo proces.
											{completedCount < employeeTotal &&
												` ${employeeTotal - completedCount} pracownikow nie ukonczylo — ich foldery nie beda uwzglednione.`}
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Anuluj</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => readyMutation.mutate()}
											disabled={readyMutation.isPending}
										>
											{readyMutation.isPending ? "Zapisywanie..." : "Potwierdz"}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						)}
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

				{readyMutation.isError && (
					<p className="mb-3 text-sm text-destructive">{readyMutation.error.message}</p>
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
	magicLinkSentAt: string | null;
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
	const sentCount = employees.filter((e) => e.magicLinkSentAt).length;

	return (
		<div className="space-y-3">
			{employees.length > 0 && (
				<div className="flex gap-4 text-sm text-muted-foreground">
					<span>
						Linki: {sentCount}/{employees.length} wyslano
					</span>
					<span>
						Ukonczonych: {completedCount}/{employees.length}
					</span>
				</div>
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
					const linkSent = !!employee.magicLinkSentAt;
					return (
						<div
							key={employee.id}
							className="flex items-center justify-between rounded-md border border-border p-3"
						>
							<div>
								<p className="text-sm font-medium text-foreground">
									{employee.name || employee.email}
								</p>
								{employee.name && <p className="text-xs text-muted-foreground">{employee.email}</p>}
								{deptNames && <p className="mt-0.5 text-xs text-muted-foreground">{deptNames}</p>}
							</div>
							<div className="flex gap-2">
								{linkSent ? (
									<Badge variant={oauthInfo.variant}>{oauthInfo.label}</Badge>
								) : (
									<Badge variant="outline">Nie wyslano linku</Badge>
								)}
								{employee.oauthStatus === "authorized" && (
									<Badge variant={selectionInfo.variant}>{selectionInfo.label}</Badge>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
