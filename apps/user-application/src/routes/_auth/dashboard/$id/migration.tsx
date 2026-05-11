import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDeploymentById } from "@/core/functions/deployments/direct";
import { getEmployeesByDeployment } from "@/core/functions/employees/binding";
import {
	getMigrationJobStatus,
	listMigrationJobs,
	type MigrationJobDto,
	triggerBackupJob,
	triggerGDriveRestoreJob,
	triggerIngestJob,
	triggerMigrateJob,
} from "@/core/functions/migration/binding";
import { useMigrationJobLogs } from "@/core/hooks/use-migration-job-logs";

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
	backup: "Zapisz kopię",
	migrate: "Przywróć kopię",
	"gdrive-restore": "Wyślij na dysk firmowy",
	ingest: "Pobierz dane",
};

function ActiveJobPanelGroup({
	activeJob,
	jobs,
}: {
	activeJob: MigrationJobDto | undefined;
	jobs: MigrationJobDto[];
}) {
	const latestJob = jobs[0];
	const logsJobId = activeJob?.id ?? latestJob?.id ?? null;
	const logSubtitle = activeJob
		? "Na zywo z runnera (SSE)."
		: "Powtorzenie bufora z runnera dla ostatniego joba — po restarcie runnera lub dlugim czasie lista moze byc pusta.";

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Aktywny job</CardTitle>
					<CardDescription>
						{activeJob
							? "Job w kolejce lub w trakcie — ponizej live logi z runnera."
							: latestJob
								? "Brak joba w trakcie. Ponizej podsumowanie ostatniego z historii oraz logi (jesli runner jeszcze je trzyma w pamieci)."
								: "Uruchom akcje ponizej — wtedy pojawi sie job i logi."}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					{activeJob ? (
						<JobRow job={activeJob} />
					) : latestJob ? (
						<div className="space-y-2">
							<p className="text-sm text-muted-foreground">Brak aktywnego joba.</p>
							<div>
								<p className="mb-1 text-xs font-medium text-muted-foreground">Ostatni job</p>
								<JobRow job={latestJob} />
							</div>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Brak aktywnego joba i brak historii dla tego wdrozenia.
						</p>
					)}
				</CardContent>
			</Card>

			{logsJobId ? <LiveLogsPanel jobId={logsJobId} subtitle={logSubtitle} /> : null}
		</>
	);
}

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

	const waitForJobDone = async (jobId: string): Promise<void> => {
		for (let attempt = 0; attempt < 120; attempt++) {
			const job = await getMigrationJobStatus({ data: { jobId } });
			if (job.status === "done") return;
			if (job.status === "failed") {
				throw new Error(
					`Job ${TYPE_LABEL[job.type]} zakonczyl sie bledem (exit: ${job.exitCode ?? "?"})`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		throw new Error("Przekroczono czas oczekiwania na zakonczenie joba");
	};

	const triggerJobWithRetry = async (
		trigger: () => Promise<MigrationJobDto>,
	): Promise<MigrationJobDto> => {
		for (let attempt = 0; attempt < 20; attempt++) {
			try {
				return await trigger();
			} catch (error) {
				const message = error instanceof Error ? error.message : "";
				const isActiveJobError = message.includes("Inny job migracji jest juz aktywny");
				if (!isActiveJobError || attempt === 19) throw error;
				await refetchJobs();
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		}
		throw new Error("Nie udalo sie uruchomic pobierania danych");
	};

	const ingestAllMutation = useMutation({
		mutationFn: async (input: { employeeIds: string[] }) => {
			for (const employeeId of input.employeeIds) {
				const job = await triggerJobWithRetry(() =>
					triggerIngestJob({
						data: { deploymentId, employeeId },
					}),
				);
				await refetchJobs();
				await waitForJobDone(job.id);
				await refetchJobs();
			}
			return input.employeeIds.length;
		},
		onSuccess: (count) => {
			toast.success(`Pobieranie danych uruchomione dla ${count} pracownikow`);
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const gdriveRestoreAllMutation = useMutation({
		mutationFn: async (input: { accounts: string[] }) => {
			for (const account of input.accounts) {
				const job = await triggerJobWithRetry(() =>
					triggerGDriveRestoreJob({
						data: { deploymentId, account },
					}),
				);
				await refetchJobs();
				await waitForJobDone(job.id);
				await refetchJobs();
			}
			return input.accounts.length;
		},
		onSuccess: (count) => {
			toast.success(`Wysyłka na dysk firmowy uruchomiona dla ${count} pracownikow`);
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const backupMutation = useMutation({
		mutationFn: (input: { account?: string }) =>
			triggerBackupJob({ data: { deploymentId, account: input.account } }),
		onSuccess: () => {
			toast.success("Zapis kopii uruchomiony");
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
				job.dryRun ? "Podgląd przywracania uruchomiony" : "Przywracanie kopii uruchomione",
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
			toast.success("Wysyłka na dysk firmowy uruchomiona");
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
			toast.success("Pobieranie danych uruchomione");
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

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
			toast.success("Pobieranie danych i wysylka na dysk firmowy uruchomione");
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
				<h1 className="text-2xl font-bold text-foreground">Migracja: {deployment.clientName}</h1>
			</div>

			<ActiveJobPanelGroup activeJob={activeJob} jobs={jobs} />

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
					<Button
						variant="destructive"
						onClick={() => backupMutation.mutate({})}
						disabled={backupMutation.isPending || !!activeJob}
					>
						Zapisz kopie
					</Button>
					<MigrateAllButton
						onConfirm={() => migrateMutation.mutate({ dryRun: false })}
						disabled={migrateMutation.isPending || !!activeJob}
					/>
					<GDriveRestoreAllButton
						onConfirm={() =>
							gdriveRestoreAllMutation.mutate({
								accounts: readyEmployees.map((employee) => employee.email),
							})
						}
						disabled={
							gdriveRestoreAllMutation.isPending || !!activeJob || readyEmployees.length === 0
						}
						count={readyEmployees.length}
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
									onDryRun={() => migrateMutation.mutate({ account: emp.email, dryRun: true })}
									onMigrate={() => migrateMutation.mutate({ account: emp.email, dryRun: false })}
									onGDriveRestore={() => gdriveRestoreMutation.mutate({ account: emp.email })}
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
	const ready = props.oauthStatus === "authorized" && props.selectionStatus === "completed";
	return (
		<div className="flex items-center justify-between rounded border border-border p-3">
			<div className="flex flex-col">
				<span className="text-sm font-medium text-foreground">{props.name || props.email}</span>
				<span className="text-xs text-muted-foreground">{props.email}</span>
			</div>
			<div className="flex items-center gap-2">
				<Badge variant={ready ? "default" : "secondary"}>{ready ? "Gotowy" : "Niegotowy"}</Badge>
				<IngestRowButton
					onConfirm={props.onIngest}
					disabled={props.disabled || !ready}
					email={props.email}
				/>
				<Button size="sm" variant="destructive" onClick={props.onBackup} disabled={props.disabled}>
					Zapisz kopię
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

function IngestRowButton({ onConfirm, disabled, email }: ConfirmActionProps & { email: string }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="default" disabled={disabled}>
					Pobierz dane
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Pobierz dane pracownika {email}</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z prywatnego Google Drive pracownika zostana sciagniete na lokalny katalog VPSa.
						Synchronizowane sa foldery wybrane przez pracownika podczas onboardingu. Po skonczeniu
						masz dane lokalnie i mozesz: Zapisz kopię albo Wyślij na dysk firmowy. Kontynuowac?
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
					Wyślij na dysk firmowy
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Wyślij {email} na dysk firmowy</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z lokalnego katalogu na VPSie (`{`{backup_path}`}/{email}`) zostana wyslane na
						firmowy shared drive (folder `{email}/`). Wymaga ze lokalny katalog ma juz dane — po
						wczesniejszym Pobierz dane lub Przywróć kopię. Akcja moze nadpisac istniejace pliki.
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

function LiveLogsPanel({ jobId, subtitle }: { jobId: string; subtitle: string }) {
	const state = useMigrationJobLogs(jobId);
	const [autoscroll, setAutoscroll] = useState(true);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: musi reagowac na nowe linie logu, nie tylko na autoscroll
	useEffect(() => {
		if (autoscroll && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [state.lines, autoscroll]);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center justify-between gap-3">
					<span>
						Live logi
						{state.lines.length > 0 ? (
							<span className="ml-2 text-sm font-normal text-muted-foreground">
								({state.lines.length} linii)
							</span>
						) : null}
					</span>
					<div className="flex items-center gap-3 text-sm font-normal">
						<Badge variant={state.connected ? "default" : "secondary"}>
							{state.connected ? "Polaczony" : (state.error ?? "Laczenie...")}
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
				<CardDescription>{subtitle}</CardDescription>
			</CardHeader>
			<CardContent>
				<div
					ref={scrollRef}
					className="max-h-[min(70vh,32rem)] min-h-[12rem] overflow-auto rounded border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground"
				>
					{state.lines.length === 0 && !state.connected && state.error ? (
						<p className="text-muted-foreground">
							Brak linii — {state.error}. Dla starych jobow runner mogl juz zwolnic bufor; pelna
							historia jest w sekcji Historia (status / exit).
						</p>
					) : state.lines.length === 0 ? (
						<p className="text-muted-foreground">
							Czekam na linie logow… Jesli job juz sie skonczyl, runner moze najpierw wyslac bufor
							(replay), potem zamknac polaczenie.
						</p>
					) : (
						state.lines.map((l, i) => (
							<div key={`${l.ts}-${i}`} className={l.stream === "stderr" ? "text-destructive" : ""}>
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
					Przywróć kopie
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Potwierdź: Przywróć kopie</AlertDialogTitle>
					<AlertDialogDescription>
						Akcja sciagnie pliki z B2 (backup) do lokalnego katalogu na VPSie (`backup_path`).
						Operacja nadpisuje dane lokalne — jesli B2 jest pusty, lokalny katalog zostanie
						wyczyszczony. Po przywroceniu mozesz uzyc Wyślij na dysk firmowy. Kontynuowac?
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
						Tak, przywróć kopie
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function MigrateRowButton({ onConfirm, disabled, email }: ConfirmActionProps & { email: string }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="destructive" disabled={disabled}>
					Przywróć kopię
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Przywróć {email} z B2</AlertDialogTitle>
					<AlertDialogDescription>
						Pliki z B2 (backup) dla konta {email} zostana sciagniete na lokalny katalog VPSa
						(`backup_path`). Operacja nadpisuje dane lokalne — jesli B2 jest pusty, lokalny katalog
						zostanie wyczyszczony. Po przywroceniu mozesz uzyc Wyślij na dysk firmowy. Kontynuowac?
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
						Tak, przywróć kopię
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function IngestAllButton({ onConfirm, disabled, count }: ConfirmActionProps & { count: number }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button disabled={disabled}>Pobierz dane</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Pobierz dane (wszyscy gotowi)</AlertDialogTitle>
					<AlertDialogDescription>
						Uruchomi pobieranie z prywatnych Drive'ow dla wszystkich gotowych pracownikow ({count}).
						Dane trafią najpierw na VPS (backup_path). Pozniej mozesz uruchomic Zapisz kopie lub
						Wyślij na dysk firmowy. Kontynuowac?
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

function GDriveRestoreAllButton({
	onConfirm,
	disabled,
	count,
}: ConfirmActionProps & { count: number }) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button disabled={disabled}>Wyślij na dysk firmowy</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Wyślij dane na dysk firmowy</AlertDialogTitle>
					<AlertDialogDescription>
						Uruchomi wysylke danych dla wszystkich gotowych pracownikow ({count}) na firmowy shared
						drive. Wymaga wczesniejszego pobrania danych na VPS. Kontynuowac?
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
