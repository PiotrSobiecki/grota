import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getDeploymentById } from "@/core/functions/deployments/direct";
import { getEmployeesByDeployment } from "@/core/functions/employees/binding";
import { useMigrationJobLogs } from "@/core/hooks/use-migration-job-logs";
import {
	getMigrationJobStatus,
	listMigrationJobs,
	type MigrationJobDto,
	triggerBackupJob,
	triggerGDriveRestoreJob,
	triggerMigrateJob,
} from "@/core/functions/migration/binding";
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

export const Route = createFileRoute("/_auth/dashboard/$id/migration")({
	loader: ({ params }) => getDeploymentById({ data: { id: params.id } }),
	component: MigrationPage,
});

const STATUS_BADGE: Record<
	MigrationJobDto["status"],
	{ label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
	queued: { label: "W kolejce", variant: "secondary" },
	running: { label: "W trakcie", variant: "outline" },
	done: { label: "Ukonczony", variant: "default" },
	failed: { label: "Blad", variant: "destructive" },
};

const TYPE_LABEL: Record<MigrationJobDto["type"], string> = {
	backup: "Backup",
	migrate: "Migracja B2 → lokalny",
	"gdrive-restore": "Przywracanie do Workspace",
};

function MigrationPage() {
	const deployment = Route.useLoaderData();
	const deploymentId = deployment.id;

	const employeesQuery = useQuery({
		queryKey: ["employees", deploymentId],
		queryFn: () => getEmployeesByDeployment({ data: { deploymentId } }),
	});

	const jobsQuery = useQuery({
		queryKey: ["migration-jobs", deploymentId],
		queryFn: () => listMigrationJobs({ data: { deploymentId, limit: 50 } }),
		refetchInterval: (q) => {
			const list = q.state.data;
			if (!list) return false;
			return list.some((j) => j.status === "running" || j.status === "queued") ? 2000 : false;
		},
	});

	const refetchJobs = () => jobsQuery.refetch();

	const backupMutation = useMutation({
		mutationFn: (input: { account?: string }) =>
			triggerBackupJob({ data: { deploymentId, account: input.account } }),
		onSuccess: () => {
			toast.success("Backup uruchomiony");
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const migrateMutation = useMutation({
		mutationFn: (input: { account?: string; dryRun: boolean }) =>
			triggerMigrateJob({
				data: { deploymentId, account: input.account, dryRun: input.dryRun },
			}),
		onSuccess: (job) => {
			toast.success(job.dryRun ? "Dry-run uruchomiony" : "Migracja uruchomiona");
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const gdriveRestoreMutation = useMutation({
		mutationFn: (input: { account: string }) =>
			triggerGDriveRestoreJob({
				data: { deploymentId, account: input.account },
			}),
		onSuccess: () => {
			toast.success("Przywracanie do Workspace uruchomione");
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const employees = employeesQuery.data?.data ?? [];
	const jobs = jobsQuery.data ?? [];
	const activeJob = jobs.find((j) => j.status === "running" || j.status === "queued");

	useQuery({
		queryKey: ["migration-job-status", activeJob?.id],
		queryFn: async () => {
			if (!activeJob) return null;
			const fresh = await getMigrationJobStatus({ data: { jobId: activeJob.id } });
			if (fresh.status !== activeJob.status) refetchJobs();
			return fresh;
		},
		enabled: !!activeJob,
		refetchInterval: 2000,
	});

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="icon" asChild>
					<Link to="/dashboard/$id" params={{ id: deploymentId }}>
						<ArrowLeft className="h-4 w-4 text-foreground" />
					</Link>
				</Button>
				<h1 className="text-2xl font-bold text-foreground">
					Migracja: {deployment.clientName}
				</h1>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Aktywny job</CardTitle>
				</CardHeader>
				<CardContent>
					{activeJob ? (
						<JobRow job={activeJob} />
					) : (
						<p className="text-sm text-muted-foreground">Brak aktywnego joba.</p>
					)}
				</CardContent>
			</Card>

			{activeJob ? <LiveLogsPanel jobId={activeJob.id} /> : null}

			<Card>
				<CardHeader>
					<CardTitle>Akcje globalne</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-wrap gap-3">
					<Button
						onClick={() => backupMutation.mutate({})}
						disabled={backupMutation.isPending || !!activeJob}
					>
						Backup wszystkich
					</Button>
					<Button
						variant="outline"
						onClick={() => migrateMutation.mutate({ dryRun: true })}
						disabled={migrateMutation.isPending || !!activeJob}
					>
						Dry-run wszystkich
					</Button>
					<MigrateAllButton
						onConfirm={() => migrateMutation.mutate({ dryRun: false })}
						disabled={migrateMutation.isPending || !!activeJob}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Pracownicy ({employees.length})</CardTitle>
				</CardHeader>
				<CardContent>
					{employees.length === 0 ? (
						<p className="text-sm text-muted-foreground">Brak pracownikow.</p>
					) : (
						<div className="space-y-2">
							{employees.map((emp) => (
								<EmployeeRow
									key={emp.id}
									email={emp.email}
									name={emp.name}
									oauthStatus={emp.oauthStatus}
									selectionStatus={emp.selectionStatus}
									disabled={!!activeJob}
									onBackup={() => backupMutation.mutate({ account: emp.email })}
									onDryRun={() =>
										migrateMutation.mutate({ account: emp.email, dryRun: true })
									}
									onMigrate={() =>
										migrateMutation.mutate({ account: emp.email, dryRun: false })
									}
									onGDriveRestore={() =>
										gdriveRestoreMutation.mutate({ account: emp.email })
									}
								/>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Historia ({jobs.length})</CardTitle>
				</CardHeader>
				<CardContent>
					{jobs.length === 0 ? (
						<p className="text-sm text-muted-foreground">Brak historii migracji.</p>
					) : (
						<div className="space-y-2">
							{jobs.map((job) => (
								<JobRow key={job.id} job={job} />
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

interface EmployeeRowProps {
	email: string;
	name: string;
	oauthStatus: string;
	selectionStatus: string;
	disabled: boolean;
	onBackup: () => void;
	onDryRun: () => void;
	onMigrate: () => void;
	onGDriveRestore: () => void;
}

function EmployeeRow(props: EmployeeRowProps) {
	const ready =
		props.oauthStatus === "authorized" && props.selectionStatus === "completed";
	return (
		<div className="flex items-center justify-between rounded border border-border p-3">
			<div className="flex flex-col">
				<span className="text-sm font-medium text-foreground">
					{props.name || props.email}
				</span>
				<span className="text-xs text-muted-foreground">{props.email}</span>
			</div>
			<div className="flex items-center gap-2">
				<Badge variant={ready ? "default" : "secondary"}>
					{ready ? "Gotowy" : "Niegotowy"}
				</Badge>
				<Button
					size="sm"
					variant="outline"
					onClick={props.onBackup}
					disabled={props.disabled}
				>
					Backup
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={props.onDryRun}
					disabled={props.disabled || !ready}
				>
					Dry-run
				</Button>
				<MigrateRowButton
					onConfirm={props.onMigrate}
					disabled={props.disabled || !ready}
					email={props.email}
				/>
				<GDriveRestoreRowButton
					onConfirm={props.onGDriveRestore}
					disabled={props.disabled || !ready}
					email={props.email}
				/>
			</div>
		</div>
	);
}

function GDriveRestoreRowButton({
	onConfirm,
	disabled,
	email,
}: ConfirmActionProps & { email: string }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="default" disabled={disabled}>
					Przywroc do Workspace
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Przywroc {email} do Workspace</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z lokalnego katalogu na VPSie (`{`{backup_path}`}/{email}`) zostana
						skopiowane do Google Drive (folder `{email}/` na shared drive). Wymaga ze
						wczesniej wykonano Migrate (B2 → lokalny). Akcja moze nadpisac
						istniejace pliki na shared drive. Kontynuowac?
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Anuluj</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
					>
						Tak, przywroc
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function JobRow({ job }: { job: MigrationJobDto }) {
	const badge = STATUS_BADGE[job.status];
	const startedAt = new Date(job.startedAt);
	const finishedAt = job.finishedAt ? new Date(job.finishedAt) : null;
	const duration = finishedAt
		? `${Math.max(1, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))}s`
		: "—";
	return (
		<div className="flex items-center justify-between rounded border border-border p-3 text-sm">
			<div className="flex items-center gap-3">
				<Badge variant={badge.variant}>{badge.label}</Badge>
				<span className="text-foreground">
					{TYPE_LABEL[job.type]}
					{job.dryRun ? " (dry-run)" : ""}
				</span>
				<span className="text-muted-foreground">{job.account ?? "wszyscy"}</span>
			</div>
			<div className="flex items-center gap-3 text-xs text-muted-foreground">
				<span>{startedAt.toLocaleString()}</span>
				<span>czas: {duration}</span>
				{job.exitCode !== null && <span>exit: {job.exitCode}</span>}
			</div>
		</div>
	);
}

function LiveLogsPanel({ jobId }: { jobId: string }) {
	const state = useMigrationJobLogs(jobId);
	const [autoscroll, setAutoscroll] = useState(true);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (autoscroll && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [state.lines, autoscroll]);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center justify-between gap-3">
					<span>Live logi</span>
					<div className="flex items-center gap-3 text-sm font-normal">
						<Badge variant={state.connected ? "default" : "secondary"}>
							{state.connected ? "Polaczony" : state.error ?? "Laczenie..."}
						</Badge>
						<label className="flex cursor-pointer items-center gap-1 text-muted-foreground">
							<input
								type="checkbox"
								checked={autoscroll}
								onChange={(e) => setAutoscroll(e.target.checked)}
							/>
							autoscroll
						</label>
					</div>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div
					ref={scrollRef}
					className="max-h-96 overflow-auto rounded border border-border bg-muted/40 p-3 font-mono text-xs text-foreground"
				>
					{state.lines.length === 0 ? (
						<p className="text-muted-foreground">Czekam na linie logow...</p>
					) : (
						state.lines.map((l, i) => (
							<div
								key={`${l.ts}-${i}`}
								className={l.stream === "stderr" ? "text-destructive" : ""}
							>
								<span className="text-muted-foreground">{l.ts.slice(11, 19)} </span>
								{l.line}
							</div>
						))
					)}
				</div>
			</CardContent>
		</Card>
	);
}

interface ConfirmActionProps {
	onConfirm: () => void;
	disabled: boolean;
}

function MigrateAllButton({ onConfirm, disabled }: ConfirmActionProps) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button variant="destructive" disabled={disabled}>
					Migruj wszystkich
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Potwierdz migracje wszystkich</AlertDialogTitle>
					<AlertDialogDescription>
						Akcja sciagnie pliki z B2 do lokalnego katalogu na VPSie
						(`backup_path`). Operacja nadpisuje dane lokalne — jesli B2 jest
						pusty, lokalny katalog zostanie wyczyszczony. Kontynuowac?
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Anuluj</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
					>
						Tak, migruj
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function MigrateRowButton({
	onConfirm,
	disabled,
	email,
}: ConfirmActionProps & { email: string }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="destructive" disabled={disabled}>
					Migruj
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Migruj {email}</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z B2 dla konta {email} zostana sciagniete do lokalnego
						katalogu na VPSie (`backup_path`). Operacja nadpisuje dane
						lokalne — jesli B2 jest pusty, lokalny katalog zostanie
						wyczyszczony. Kontynuowac?
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Anuluj</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
					>
						Tak, migruj
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
