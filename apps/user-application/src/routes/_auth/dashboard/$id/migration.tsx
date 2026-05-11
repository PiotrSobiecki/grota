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
	triggerIngestJob,
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
	backup: "Backup do B2",
	migrate: "Przywracanie z B2",
	"gdrive-restore": "Wysyłanie do Workspace",
	ingest: "Pobieranie z Drive",
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
			toast.success("Backup do B2 uruchomiony");
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
			toast.success(
				job.dryRun ? "Podgląd przywracania uruchomiony" : "Przywracanie z B2 uruchomione",
			);
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
			toast.success("Wysyłanie do Workspace uruchomione");
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const ingestMutation = useMutation({
		mutationFn: (input: { employeeId: string }) =>
			triggerIngestJob({
				data: { deploymentId, employeeId: input.employeeId },
			}),
		onSuccess: () => {
			toast.success("Pobieranie z Drive uruchomione");
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const ingestAllMutation = useMutation({
		mutationFn: async (input: { employeeIds: string[] }) => {
			for (const employeeId of input.employeeIds) {
				await triggerIngestJob({
					data: { deploymentId, employeeId },
				});
			}
			return input.employeeIds.length;
		},
		onSuccess: (count) => {
			toast.success(`Pobieranie z Drive uruchomione dla ${count} pracownikow`);
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const waitForJobDone = async (jobId: string): Promise<void> => {
		for (let attempt = 0; attempt < 120; attempt++) {
			const job = await getMigrationJobStatus({ data: { jobId } });
			if (job.status === "done") return;
			if (job.status === "failed") {
				throw new Error(`Job ${TYPE_LABEL[job.type]} zakonczyl sie bledem (exit: ${job.exitCode ?? "?"})`);
			}
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		throw new Error("Przekroczono czas oczekiwania na zakonczenie joba");
	};

	const ingestAndRestoreMutation = useMutation({
		mutationFn: async (input: { employeeId: string; account: string }) => {
			const ingestJob = await triggerIngestJob({
				data: { deploymentId, employeeId: input.employeeId },
			});
			await waitForJobDone(ingestJob.id);
			await triggerGDriveRestoreJob({
				data: { deploymentId, account: input.account },
			});
		},
		onSuccess: () => {
			toast.success("Pobieranie i wysylka do Workspace uruchomione");
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const ingestAndRestoreAllMutation = useMutation({
		mutationFn: async (input: { employees: Array<{ id: string; email: string }> }) => {
			for (const employee of input.employees) {
				const ingestJob = await triggerIngestJob({
					data: { deploymentId, employeeId: employee.id },
				});
				await waitForJobDone(ingestJob.id);
				await triggerGDriveRestoreJob({
					data: { deploymentId, account: employee.email },
				});
			}
			return input.employees.length;
		},
		onSuccess: (count) => {
			toast.success(`Pobieranie + wysylka uruchomione dla ${count} pracownikow`);
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const employees = employeesQuery.data?.data ?? [];
	const readyEmployees = employees.filter(
		(e) => e.oauthStatus === "authorized" && e.selectionStatus === "completed",
	);
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
					<IngestAllButton
						onConfirm={() =>
							ingestAllMutation.mutate({
								employeeIds: readyEmployees.map((employee) => employee.id),
							})
						}
						disabled={ingestAllMutation.isPending || !!activeJob || readyEmployees.length === 0}
						count={readyEmployees.length}
					/>
					<IngestAndRestoreAllButton
						onConfirm={() =>
							ingestAndRestoreAllMutation.mutate({
								employees: readyEmployees.map((employee) => ({
									id: employee.id,
									email: employee.email,
								})),
							})
						}
						disabled={
							ingestAndRestoreAllMutation.isPending ||
							!!activeJob ||
							readyEmployees.length === 0
						}
						count={readyEmployees.length}
					/>
					<Button
						variant="destructive"
						onClick={() => backupMutation.mutate({})}
						disabled={backupMutation.isPending || !!activeJob}
					>
						Backup wszystkich do B2
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
									employeeId={emp.id}
									email={emp.email}
									name={emp.name}
									oauthStatus={emp.oauthStatus}
									selectionStatus={emp.selectionStatus}
									disabled={!!activeJob}
									onIngest={() => ingestMutation.mutate({ employeeId: emp.id })}
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
									onIngestAndRestore={() =>
										ingestAndRestoreMutation.mutate({
											employeeId: emp.id,
											account: emp.email,
										})
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
	employeeId: string;
	email: string;
	name: string;
	oauthStatus: string;
	selectionStatus: string;
	disabled: boolean;
	onIngest: () => void;
	onBackup: () => void;
	onDryRun: () => void;
	onMigrate: () => void;
	onGDriveRestore: () => void;
	onIngestAndRestore: () => void;
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
				<IngestRowButton
					onConfirm={props.onIngest}
					disabled={props.disabled || !ready}
					email={props.email}
				/>
				<Button
					size="sm"
					variant="outline"
					onClick={props.onBackup}
					disabled={props.disabled}
				>
					Backup do B2
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
				<IngestAndRestoreRowButton
					onConfirm={props.onIngestAndRestore}
					disabled={props.disabled || !ready}
					email={props.email}
				/>
			</div>
		</div>
	);
}

function IngestRowButton({
	onConfirm,
	disabled,
	email,
}: ConfirmActionProps & { email: string }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="default" disabled={disabled}>
					Pobierz z Drive
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Pobierz {email} z Drive</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z prywatnego Google Drive pracownika zostana sciagniete na
						lokalny katalog VPSa. Synchronizowane sa foldery wybrane przez
						pracownika podczas onboardingu. Po skonczeniu masz dane lokalnie
						i mozesz: zrobic Backup do B2 (off-site) albo Wyslac do Workspace
						(shared drive firmy). Kontynuowac?
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
						Tak, pobierz
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
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
					Wyślij do Workspace
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Wyślij {email} do Workspace</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z lokalnego katalogu na VPSie (`{`{backup_path}`}/{email}`)
						zostana wyslane na Workspace shared drive firmy (folder `{email}/`).
						Wymaga ze lokalny katalog ma juz dane — po wczesniejszym Pobierz z
						Drive lub Przywróć z B2. Akcja moze nadpisac istniejace pliki na
						shared drive. Kontynuowac?
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
						Tak, wyślij
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
					Przywróć wszystkich z B2
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Potwierdź przywracanie wszystkich z B2</AlertDialogTitle>
					<AlertDialogDescription>
						Akcja sciagnie pliki z B2 (backup) do lokalnego katalogu na VPSie
						(`backup_path`). Operacja nadpisuje dane lokalne — jesli B2 jest
						pusty, lokalny katalog zostanie wyczyszczony. Po przywroceniu mozesz
						uzyc Wyslij do Workspace. Kontynuowac?
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
						Tak, przywróć z B2
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
				<Button size="sm" variant="outline" disabled={disabled}>
					Przywróć z B2
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Przywróć {email} z B2</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z B2 (backup) dla konta {email} zostana sciagniete na
						lokalny katalog VPSa (`backup_path`). Operacja nadpisuje dane
						lokalne — jesli B2 jest pusty, lokalny katalog zostanie
						wyczyszczony. Po przywroceniu mozesz uzyc Wyslij do Workspace.
						Kontynuowac?
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
						Tak, przywróć z B2
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function IngestAllButton({
	onConfirm,
	disabled,
	count,
}: ConfirmActionProps & { count: number }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button disabled={disabled}>Pobierz z Drive (wszyscy)</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Pobierz z Drive dla wszystkich gotowych</AlertDialogTitle>
					<AlertDialogDescription>
						Uruchomi pobieranie z prywatnych Drive'ow dla wszystkich gotowych
						pracownikow ({count}). Dane trafią najpierw na VPS (backup_path).
						Pozniej mozesz uruchomic backup do B2 lub wysylke do Workspace.
						Kontynuowac?
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
						Tak, pobierz dla wszystkich
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function IngestAndRestoreAllButton({
	onConfirm,
	disabled,
	count,
}: ConfirmActionProps & { count: number }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button variant="default" disabled={disabled}>
					Pobierz i wyslij (wszyscy)
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Pobierz i wyslij do Workspace (wszyscy)</AlertDialogTitle>
					<AlertDialogDescription>
						Dla kazdego gotowego pracownika ({count}) uruchomi sekwencje:
						Pobierz z Drive, a po sukcesie Wyslij do Workspace. W razie bledu
						pobierania dalsze kroki zostana zatrzymane. Kontynuowac?
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
						Tak, uruchom sekwencje
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function IngestAndRestoreRowButton({
	onConfirm,
	disabled,
	email,
}: ConfirmActionProps & { email: string }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="default" disabled={disabled}>
					Pobierz i wyslij
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Pobierz i wyslij {email}</AlertDialogTitle>
					<AlertDialogDescription>
						Uruchomi sekwencje dla konta {email}: najpierw Pobierz z Drive,
						a po sukcesie automatycznie Wyslij do Workspace. Jezeli pobieranie
						sie nie powiedzie, wysylka nie zostanie uruchomiona. Kontynuowac?
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
						Tak, pobierz i wyslij
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
