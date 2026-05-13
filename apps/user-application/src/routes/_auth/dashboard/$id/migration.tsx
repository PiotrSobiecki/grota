import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { getDeploymentSchedule, setSchedule } from "@/core/functions/schedule/binding";
import {
	type MigrationLogLine,
	type MigrationLogState,
	useMigrationJobLogs,
} from "@/core/hooks/use-migration-job-logs";

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
	"scheduled-cycle": "Auto cykl",
};

function ActiveJobPanelGroup({
	activeJob,
	jobs,
	globalOpJobs,
}: {
	activeJob: MigrationJobDto | undefined;
	jobs: MigrationJobDto[];
	globalOpJobs: GlobalOpJob[];
}) {
	if (globalOpJobs.length > 0) {
		return (
			<GlobalOpPanel activeJob={activeJob} jobs={jobs} globalOpJobs={globalOpJobs} />
		);
	}
	const latestJob = jobs[0];
	const logsJobId = activeJob?.id ?? latestJob?.id ?? null;
	const logsJob = logsJobId ? jobs.find((j) => j.id === logsJobId) : undefined;
	const streamLogs = !!logsJob && (logsJob.status === "queued" || logsJob.status === "running");
	const logSubtitle = activeJob
		? "Na zywo z runnera (SSE)."
		: "Bez joba w kolejce lub w trakcie nie laczymy z runnerem — po zakonczeniu joba logi zatrzymuja sie; nowy job znowu wlaczy transmisje.";

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Aktywny job</CardTitle>
					<CardDescription>
						{activeJob
							? "Job w kolejce lub w trakcie — ponizej live logi z runnera."
							: latestJob
								? "Brak joba w trakcie. Ponizej ostatni job z historii; panel logow pokazuje transmisje tylko gdy job jest w kolejce lub dziala."
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

			{logsJobId ? (
				<LiveLogsPanel jobId={logsJobId} subtitle={logSubtitle} streamLogs={streamLogs} />
			) : null}
		</>
	);
}

interface PerJobLines {
	label: string;
	lines: MigrationLogLine[];
}

function JobLogStreamer({
	jobId,
	label,
	streamLogs,
	onLines,
}: {
	jobId: string;
	label: string;
	streamLogs: boolean;
	onLines: (jobId: string, label: string, lines: MigrationLogLine[]) => void;
}) {
	const state = useMigrationJobLogs(jobId, streamLogs);
	useEffect(() => {
		onLines(jobId, label, state.lines);
	}, [jobId, label, state.lines, onLines]);
	return null;
}

function GlobalOpPanel({
	activeJob,
	jobs,
	globalOpJobs,
}: {
	activeJob: MigrationJobDto | undefined;
	jobs: MigrationJobDto[];
	globalOpJobs: GlobalOpJob[];
}) {
	const kindLabel =
		globalOpJobs[0]?.kind === "ingest" ? "Pobieranie danych" : "Wysyłka na dysk firmowy";
	const finishedCount = globalOpJobs.filter((g) => {
		const job = jobs.find((j) => j.id === g.jobId);
		return job?.status === "done" || job?.status === "failed";
	}).length;
	const inProgress = !!activeJob && globalOpJobs.some((g) => g.jobId === activeJob.id);

	const [perJobLines, setPerJobLines] = useState<Record<string, PerJobLines>>({});
	const handleLines = useCallback((jobId: string, label: string, lines: MigrationLogLine[]) => {
		setPerJobLines((prev) => ({ ...prev, [jobId]: { label, lines } }));
	}, []);

	const [autoscroll, setAutoscroll] = useState(true);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	const aggregated = globalOpJobs.flatMap((g) => {
		const entry = perJobLines[g.jobId];
		if (!entry) return [];
		return entry.lines.map((l) => ({ ...l, label: g.label }));
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: musi reagowac na nowe linie
	useEffect(() => {
		if (autoscroll && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [aggregated.length, autoscroll]);

	const copyAllLogs = async () => {
		if (aggregated.length === 0) return;
		const text = aggregated
			.map(
				(l) =>
					`${l.stream === "stderr" ? "[stderr] " : ""}${l.ts.slice(11, 19)} [${l.label}] ${l.line}`,
			)
			.join("\n");
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Skopiowano logi do schowka");
		} catch {
			toast.error("Nie udalo sie skopiowac (np. brak uprawnien przegladarki)");
		}
	};

	return (
		<>
			{globalOpJobs.map((g) => {
				const job = jobs.find((j) => j.id === g.jobId);
				const isActive = !!job && (job.status === "queued" || job.status === "running");
				return (
					<JobLogStreamer
						key={g.jobId}
						jobId={g.jobId}
						label={g.label}
						streamLogs={isActive}
						onLines={handleLines}
					/>
				);
			})}
			<Card>
				<CardHeader>
					<CardTitle>Akcja globalna: {kindLabel}</CardTitle>
					<CardDescription>
						{inProgress
							? `W trakcie — ${finishedCount}/${globalOpJobs.length} pracownikow zakonczone.`
							: `Zakonczone — ${finishedCount}/${globalOpJobs.length} pracownikow.`}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex flex-wrap gap-2">
						{globalOpJobs.map((g) => {
							const job = jobs.find((j) => j.id === g.jobId);
							const status = job?.status ?? "queued";
							const variant: "default" | "secondary" | "destructive" | "outline" =
								status === "done"
									? "secondary"
									: status === "failed"
										? "destructive"
										: status === "running"
											? "default"
											: "outline";
							return (
								<Badge key={g.jobId} variant={variant}>
									{g.label} · {status}
								</Badge>
							);
						})}
					</div>
				</CardContent>
			</Card>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0">
					<div>
						<CardTitle>Logi (zagregowane)</CardTitle>
						<CardDescription>
							Linie ze wszystkich pracownikow w tej akcji globalnej, z prefiksem [email].
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<label className="flex items-center gap-1 text-xs text-muted-foreground">
							<input
								type="checkbox"
								className="h-3 w-3 accent-primary"
								checked={autoscroll}
								onChange={(e) => setAutoscroll(e.target.checked)}
							/>
							Autoscroll
						</label>
						<Button variant="outline" size="sm" onClick={copyAllLogs}>
							<Copy className="mr-1 h-3 w-3" />
							Kopiuj
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<div
						ref={scrollRef}
						className="h-96 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
					>
						{aggregated.length === 0 ? (
							<p className="text-muted-foreground">Brak logow.</p>
						) : (
							aggregated.map((l, i) => (
								<div
									key={`${l.ts}-${i}`}
									className={l.stream === "stderr" ? "text-destructive" : "text-foreground"}
								>
									<span className="text-muted-foreground">{l.ts.slice(11, 19)}</span>{" "}
									<span className="text-muted-foreground">[{l.label}]</span> {l.line}
								</div>
							))
						)}
					</div>
				</CardContent>
			</Card>
		</>
	);
}

type IntervalPreset = 1 | 6 | 12 | 24 | 168;

const INTERVAL_LABELS: Record<IntervalPreset, string> = {
	1: "Co 1h",
	6: "Co 6h",
	12: "Co 12h",
	24: "Co 24h",
	168: "Co 7 dni",
};

function formatScheduleDate(iso: string | null): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return new Intl.DateTimeFormat("pl-PL", {
		dateStyle: "short",
		timeStyle: "short",
		timeZone: "Europe/Warsaw",
	}).format(d);
}

function formatLastStatus(status: string | null): string | null {
	if (!status) return null;
	if (status === "ok") return "Sukces";
	if (status === "skipped:locked") return "Pominięto";
	if (status === "retry_pending") return "Ponawianie";
	if (status === "failed:CONFIG_INCOMPLETE_COMPANY_DRIVE")
		return "Brak konfiguracji dysku firmowego — uzupełnij OAuth";
	if (status === "failed" || status.startsWith("failed:")) return "Błąd";
	return status;
}

function ScheduleWidget({
	schedule,
	loading,
	saving,
	onSave,
}: {
	schedule: {
		enabled: boolean;
		intervalHours: number;
		anchorTime: string;
		nextRunAt: string | null;
		lastRunAt: string | null;
		lastStatus: string | null;
		includeGdriveRestore: boolean;
	} | null;
	loading: boolean;
	saving: boolean;
	onSave: (input: {
		enabled: boolean;
		intervalHours: IntervalPreset;
		anchorTime: string;
		includeGdriveRestore: boolean;
	}) => void;
}) {
	const enabled = schedule?.enabled ?? false;
	const intervalHours = (schedule?.intervalHours ?? 24) as IntervalPreset;
	const anchorTime = (schedule?.anchorTime ?? "02:00").slice(0, 5);
	const includeGdriveRestore = schedule?.includeGdriveRestore ?? false;
	const nextRun = formatScheduleDate(schedule?.nextRunAt ?? null);
	const lastRun = formatScheduleDate(schedule?.lastRunAt ?? null);

	const handleToggle = (checked: boolean) =>
		onSave({ enabled: checked, intervalHours, anchorTime, includeGdriveRestore });
	const handleInterval = (value: string) => {
		const next = Number(value) as IntervalPreset;
		onSave({ enabled, intervalHours: next, anchorTime, includeGdriveRestore });
	};
	const handleAnchor = (value: string) =>
		onSave({ enabled, intervalHours, anchorTime: value, includeGdriveRestore });
	const handleRestoreToggle = (checked: boolean) =>
		onSave({ enabled, intervalHours, anchorTime, includeGdriveRestore: checked });

	return (
		<div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3">
			<div className="flex flex-wrap items-center gap-4">
				<label className="flex items-center gap-2 text-sm text-foreground">
					<input
						type="checkbox"
						className="h-4 w-4 accent-primary"
						checked={enabled}
						disabled={loading || saving}
						onChange={(e) => handleToggle(e.target.checked)}
					/>
					Harmonogram
				</label>
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					Interwał:
					<select
						className="rounded-sm border border-input bg-background px-2 py-1 text-sm text-foreground"
						value={String(intervalHours)}
						disabled={loading || saving}
						onChange={(e) => handleInterval(e.target.value)}
					>
						{([1, 6, 12, 24, 168] as IntervalPreset[]).map((k) => (
							<option key={k} value={k}>
								{INTERVAL_LABELS[k]}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					Godzina kotwicy:
					<input
						type="time"
						className="rounded-sm border border-input bg-background px-2 py-1 text-sm text-foreground"
						value={anchorTime}
						disabled={loading || saving}
						onChange={(e) => handleAnchor(e.target.value)}
					/>
				</label>
				<label className="flex items-center gap-2 text-sm text-foreground">
					<input
						type="checkbox"
						className="h-4 w-4 accent-primary"
						checked={includeGdriveRestore}
						disabled={loading || saving}
						onChange={(e) => handleRestoreToggle(e.target.checked)}
					/>
					Wyślij też na dysk firmowy (po backupie)
				</label>
			</div>
			{(nextRun || lastRun) && (
				<div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
					{nextRun && <span>Następne uruchomienie: {nextRun}</span>}
					{lastRun && (
						<span>
							Ostatnie: {lastRun}
							{formatLastStatus(schedule?.lastStatus ?? null)
								? ` — ${formatLastStatus(schedule?.lastStatus ?? null)}`
								: ""}
						</span>
					)}
				</div>
			)}
		</div>
	);
}

type GlobalOpJob = {
	jobId: string;
	label: string;
	kind: "ingest" | "gdrive-restore";
};

function MigrationPage() {
	const deployment = Route.useLoaderData();
	const deploymentId = deployment.id;

	const [globalOpJobs, setGlobalOpJobs] = useState<GlobalOpJob[]>([]);

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
		mutationFn: async (input: { employees: Array<{ id: string; email: string }> }) => {
			setGlobalOpJobs([]);
			for (const emp of input.employees) {
				const job = await triggerJobWithRetry(() =>
					triggerIngestJob({
						data: { deploymentId, employeeId: emp.id },
					}),
				);
				setGlobalOpJobs((prev) => [
					...prev,
					{ jobId: job.id, label: emp.email, kind: "ingest" },
				]);
				await refetchJobs();
				await waitForJobDone(job.id);
				await refetchJobs();
			}
			return input.employees.length;
		},
		onSuccess: (count) => {
			toast.success(`Pobieranie danych uruchomione dla ${count} pracownikow`);
			refetchJobs();
		},
		onError: (e) => toast.error(e.message),
	});

	const gdriveRestoreAllMutation = useMutation({
		mutationFn: async (input: { accounts: string[] }) => {
			setGlobalOpJobs([]);
			for (const account of input.accounts) {
				const job = await triggerJobWithRetry(() =>
					triggerGDriveRestoreJob({
						data: { deploymentId, account },
					}),
				);
				setGlobalOpJobs((prev) => [
					...prev,
					{ jobId: job.id, label: account, kind: "gdrive-restore" },
				]);
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

	const scheduleQuery = useQuery({
		queryKey: ["deployment-schedule", deploymentId],
		queryFn: () => getDeploymentSchedule({ data: { deploymentId } }),
	});

	const scheduleMutation = useMutation({
		mutationFn: (input: {
			enabled: boolean;
			intervalHours: 1 | 6 | 12 | 24 | 168;
			anchorTime: string;
			includeGdriveRestore: boolean;
		}) => setSchedule({ data: { deploymentId, ...input } }),
		onSuccess: (data) => {
			const wasEnabled = scheduleQuery.data?.enabled ?? false;
			if (data.enabled && !wasEnabled) {
				toast.success("Harmonogram uruchomiony");
			} else if (!data.enabled && wasEnabled) {
				toast.success("Harmonogram wyłączony");
			} else {
				toast.success("Harmonogram zapisany");
			}
			scheduleQuery.refetch();
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
	const globalOpInProgress = ingestAllMutation.isPending || gdriveRestoreAllMutation.isPending;
	const disableActions = !!activeJob || globalOpInProgress;

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

			<ActiveJobPanelGroup activeJob={activeJob} jobs={jobs} globalOpJobs={globalOpJobs} />

			<Card>
				<CardHeader>
					<CardTitle>Akcje globalne</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<ScheduleWidget
						schedule={scheduleQuery.data ?? null}
						loading={scheduleQuery.isLoading}
						saving={scheduleMutation.isPending}
						onSave={(input) => scheduleMutation.mutate(input)}
					/>
					<div className="flex flex-wrap gap-3">
						<IngestAllButton
							onConfirm={() =>
								ingestAllMutation.mutate({
									employees: readyEmployees.map((employee) => ({
										id: employee.id,
										email: employee.email,
									})),
								})
							}
							disabled={disableActions || readyEmployees.length === 0}
							count={readyEmployees.length}
						/>
						<Button
							variant="destructive"
							onClick={() => backupMutation.mutate({})}
							disabled={disableActions || backupMutation.isPending}
						>
							Zapisz kopie
						</Button>
						<MigrateAllButton
							onConfirm={() => migrateMutation.mutate({ dryRun: false })}
							disabled={disableActions || migrateMutation.isPending}
						/>
						<GDriveRestoreAllButton
							onConfirm={() =>
								gdriveRestoreAllMutation.mutate({
									accounts: readyEmployees.map((employee) => employee.email),
								})
							}
							disabled={disableActions || readyEmployees.length === 0}
							count={readyEmployees.length}
						/>
					</div>
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
									disabled={disableActions}
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
				<Badge variant={job.triggeredByCron ? "outline" : "secondary"}>
					{job.triggeredByCron ? "Auto" : "Admin"}
				</Badge>
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

/** Rclone (w tym -vv) pisze wiele poziomow na stderr — kolorujemy po znaczniku poziomu w linii. */
const RCLONE_STYLE_SEVERE = /\s(ERROR|FATAL|CRITICAL)\s*:/;
const RCLONE_STYLE_WARN = /\s(WARN|NOTICE)\s*:/;
const RCLONE_STYLE_INFO = /\sINFO\s*:/;
const RCLONE_STYLE_DEBUG = /\sDEBUG\s*:/;

function migrationLogLineClassName(line: string): string {
	if (RCLONE_STYLE_SEVERE.test(line)) return "text-destructive";
	if (RCLONE_STYLE_WARN.test(line)) return "text-amber-700 dark:text-amber-300";
	if (RCLONE_STYLE_INFO.test(line)) return "text-emerald-700 dark:text-emerald-400";
	if (RCLONE_STYLE_DEBUG.test(line)) return "text-muted-foreground";
	return "text-foreground";
}

function liveLogsBadgeLabel(
	connected: boolean,
	streamLogs: boolean,
	error: string | null,
	lineCount: number,
): string {
	if (connected) return "Polaczony";
	if (streamLogs) return error ?? "Laczenie...";
	if (lineCount > 0) return "Logi zatrzymane";
	return "Brak transmisji";
}

function LiveLogsScrollContent({
	lines,
	connected,
	error,
	streamLogs,
}: MigrationLogState & { streamLogs: boolean }) {
	if (lines.length === 0 && !connected && error) {
		return (
			<p className="text-muted-foreground">
				Brak linii — {error}. Dla starych jobow runner mogl juz zwolnic bufor; pelna historia jest w
				sekcji Historia (status / exit).
			</p>
		);
	}
	if (lines.length === 0 && !streamLogs) {
		return (
			<p className="text-muted-foreground">
				Job zakonczony lub w historii — transmisja wylaczona. Uruchom nowy job, zeby znowu ogladac
				logi na zywo.
			</p>
		);
	}
	if (lines.length === 0) {
		return <p className="text-muted-foreground">Czekam na linie logow z runnera…</p>;
	}
	return lines.map((l, i) => (
		<div key={`${l.ts}-${i}`} className={migrationLogLineClassName(l.line)}>
			<span className="text-muted-foreground">{l.ts.slice(11, 19)} </span>
			{l.line}
		</div>
	));
}

function LiveLogsPanel({
	jobId,
	subtitle,
	streamLogs,
}: {
	jobId: string;
	subtitle: string;
	streamLogs: boolean;
}) {
	const state = useMigrationJobLogs(jobId, streamLogs);
	const [autoscroll, setAutoscroll] = useState(true);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	const copyAllLogs = async () => {
		if (state.lines.length === 0) return;
		const text = state.lines
			.map((l) => `${l.stream === "stderr" ? "[stderr] " : ""}${l.ts.slice(11, 19)} ${l.line}`)
			.join("\n");
		try {
			await navigator.clipboard.writeText(text);
			toast.success("Skopiowano logi do schowka");
		} catch {
			toast.error("Nie udalo sie skopiowac (np. brak uprawnien przegladarki)");
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: musi reagowac na nowe linie logu, nie tylko na autoscroll
	useEffect(() => {
		if (autoscroll && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [state.lines, autoscroll]);

	const badgeText = liveLogsBadgeLabel(
		state.connected,
		streamLogs,
		state.error,
		state.lines.length,
	);

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
						<Badge variant={state.connected ? "default" : "secondary"}>{badgeText}</Badge>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="shrink-0"
							disabled={state.lines.length === 0}
							onClick={() => void copyAllLogs()}
							title="Kopiuj wszystkie logi"
						>
							<Copy className="h-4 w-4" />
						</Button>
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
					className="h-[7rem] max-h-[7rem] overflow-y-auto overflow-x-auto rounded border border-border bg-muted/40 p-2 font-mono text-xs leading-snug text-foreground"
				>
					<LiveLogsScrollContent {...state} streamLogs={streamLogs} />
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
