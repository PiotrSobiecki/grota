import type { Department } from "@repo/data-ops/department";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	Copy,
	ExternalLink,
	HardDrive,
	Loader2,
	Plus,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDepartments } from "@/core/functions/departments/binding";
import { bulkCreateEmployees, getEmployeesByDeployment } from "@/core/functions/employees/binding";
import { verifyAdminToken } from "@/core/functions/magic-links/binding";
import {
	createAndSaveSharedDrives,
	getSharedDrives,
	saveSharedDrives,
} from "@/core/functions/shared-drives/binding";
import { cn } from "@/lib/utils";

interface OnboardSearchParams {
	step?: number;
	oauth?: string;
}

export const Route = createFileRoute("/onboard/$token")({
	validateSearch: (search: Record<string, unknown>): OnboardSearchParams => ({
		step:
			typeof search.step === "string" || typeof search.step === "number"
				? Number(search.step)
				: undefined,
		oauth: typeof search.oauth === "string" ? search.oauth : undefined,
	}),
	loader: ({ params }) => verifyAdminToken({ data: { token: params.token } }),
	component: OnboardingWizard,
});

function OnboardingWizard() {
	const loaderData = Route.useLoaderData();
	const { token } = Route.useParams();
	const { step: searchStep, oauth } = Route.useSearch();
	const navigate = Route.useNavigate();

	const isLocked = loaderData.status === "ready" || loaderData.status === "active";
	const isCompleted = loaderData.step >= 5;
	const [forceSummary, setForceSummary] = useState(false);

	const serverStep = loaderData.step > 0 ? loaderData.step : 1;
	const currentStep = searchStep ?? (oauth === "success" ? 2 : serverStep);

	const goTo = (step: number) => {
		setForceSummary(false);
		navigate({ search: { step } });
	};

	if (((isCompleted || isLocked) && !searchStep) || forceSummary) {
		return (
			<div className="min-h-screen bg-background p-6">
				<div className="max-w-2xl mx-auto space-y-6">
					<h1 className="text-2xl font-bold text-foreground">Grota -- Onboarding</h1>
					<CompletedView
						deploymentId={loaderData.deploymentId}
						locked={isLocked}
						onAddMore={() => goTo(4)}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Grota -- Onboarding</h1>

				<div className="flex gap-2">
					{[1, 2, 3, 4, 5].map((s) => (
						<div
							key={s}
							className={`h-2 flex-1 rounded ${s <= currentStep ? "bg-primary" : "bg-muted"}`}
						/>
					))}
				</div>

				{currentStep === 1 && (
					<CompanyInfoStep
						clientName={loaderData.clientName}
						domain={loaderData.domain}
						adminEmail={loaderData.adminEmail}
						adminName={loaderData.adminName}
						onNext={() => goTo(2)}
					/>
				)}
				{currentStep === 2 && (
					<OAuthConsentStep
						deploymentId={loaderData.deploymentId}
						magicLinkToken={token}
						oauthSuccess={oauth === "success"}
						onNext={() => goTo(3)}
						onBack={() => goTo(1)}
					/>
				)}
				{currentStep === 3 && (
					<DelegateChecklistStep
						operatorEmail={loaderData.operatorEmail}
						onNext={() => goTo(4)}
						onBack={() => goTo(2)}
					/>
				)}
				{currentStep === 4 && (
					<SharedDriveStep
						deploymentId={loaderData.deploymentId}
						clientName={loaderData.clientName}
						locked={isLocked}
						onNext={() => goTo(5)}
						onBack={() => goTo(3)}
					/>
				)}
				{currentStep === 5 && (
					<EmployeeListStep
						deploymentId={loaderData.deploymentId}
						locked={isLocked}
						onBack={() => goTo(4)}
						onSummary={() => setForceSummary(true)}
					/>
				)}
			</div>
		</div>
	);
}

const SHARED_DRIVE_CATEGORIES = ["dokumenty", "projekty", "media"] as const;

const SHARED_DRIVE_CATEGORY_LABELS: Record<string, string> = {
	dokumenty: "Dokumenty",
	projekty: "Projekty",
	media: "Media",
};

function SharedDriveStep({
	deploymentId,
	clientName,
	locked,
	onNext,
	onBack,
}: {
	deploymentId: string;
	clientName: string;
	locked: boolean;
	onNext: () => void;
	onBack: () => void;
}) {
	const query = useQuery({
		queryKey: ["shared-drives", deploymentId],
		queryFn: () => getSharedDrives({ data: { deploymentId } }),
	});

	const [failures, setFailures] = useState<Array<{ name: string; error: string }>>([]);

	const createMutation = useMutation({
		mutationFn: (drives: Array<{ name: string; category: "dokumenty" | "projekty" | "media" }>) =>
			createAndSaveSharedDrives({ data: { deploymentId, drives } }),
		onSuccess: (result) => {
			setFailures(result.failures);
			query.refetch();
			if (result.failures.length === 0) {
				onNext();
			}
		},
	});

	const saveMutation = useMutation({
		mutationFn: (drives: Array<{ name: string; category: "dokumenty" | "projekty" | "media" }>) =>
			saveSharedDrives({ data: { deploymentId, drives } }),
		onSuccess: () => {
			query.refetch();
			onNext();
		},
	});

	const currentDrives = query.data?.data ?? [];
	const hasExistingDrives = currentDrives.some((d) => d.googleDriveId);
	const mutation = hasExistingDrives ? saveMutation : createMutation;
	const isPending = createMutation.isPending || saveMutation.isPending;

	const defaultName = (cat: string) => `${clientName}-${SHARED_DRIVE_CATEGORY_LABELS[cat]}`;

	const form = useForm({
		defaultValues: {
			dokumenty:
				currentDrives.find((d) => d.category === "dokumenty")?.name ?? defaultName("dokumenty"),
			projekty:
				currentDrives.find((d) => d.category === "projekty")?.name ?? defaultName("projekty"),
			media: currentDrives.find((d) => d.category === "media")?.name ?? defaultName("media"),
		},
		onSubmit: async ({ value }) => {
			const drives = SHARED_DRIVE_CATEGORIES.filter((cat) => value[cat].trim()).map((cat) => ({
				name: value[cat].trim(),
				category: cat,
			}));
			setFailures([]);
			mutation.reset();
			if (hasExistingDrives) {
				await saveMutation.mutateAsync(drives);
			} else {
				await createMutation.mutateAsync(drives);
			}
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<HardDrive className="h-5 w-5" />
					Krok 4: Dyski wspoldzielone
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					{hasExistingDrives
						? "Dyski zostaly utworzone. Mozesz zmienic nazwy i zapisac."
						: "Dyski zostana automatycznie utworzone w Google Workspace."}
				</p>

				{mutation.isError && <p className="text-sm text-destructive">{mutation.error.message}</p>}

				{failures.length > 0 && (
					<div className="space-y-1">
						{failures.map((f) => (
							<p key={f.name} className="text-sm text-destructive">
								{f.name}: {f.error}
							</p>
						))}
					</div>
				)}

				{query.isPending ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Ladowanie...
					</div>
				) : (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-3"
					>
						{SHARED_DRIVE_CATEGORIES.map((cat) => (
							<form.Field key={cat} name={cat}>
								{(field) => (
									<div>
										<label className="text-sm font-medium text-foreground">
											{SHARED_DRIVE_CATEGORY_LABELS[cat]}
										</label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={`np. ${defaultName(cat)}`}
											disabled={locked}
										/>
									</div>
								)}
							</form.Field>
						))}

						<div className="flex gap-2 pt-2">
							<Button type="button" variant="outline" onClick={onBack}>
								<ArrowLeft className="mr-2 h-4 w-4" />
								Wstecz
							</Button>
							{locked ? (
								<Button type="button" onClick={onNext}>
									Dalej
								</Button>
							) : (
								<form.Subscribe selector={(s) => s.canSubmit}>
									{(canSubmit) => (
										<Button type="submit" disabled={!canSubmit || isPending}>
											{isPending ? (
												<>
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
													{hasExistingDrives ? "Zapisywanie..." : "Tworzenie dyskow..."}
												</>
											) : hasExistingDrives ? (
												"Zapisz i dalej"
											) : (
												"Utworz dyski i dalej"
											)}
										</Button>
									)}
								</form.Subscribe>
							)}
						</div>
					</form>
				)}
			</CardContent>
		</Card>
	);
}

interface CompanyInfoStepProps {
	clientName: string;
	domain: string;
	adminEmail: string | null;
	adminName: string | null;
	onNext: () => void;
}

function CompanyInfoStep({
	clientName,
	domain,
	adminEmail,
	adminName,
	onNext,
}: CompanyInfoStepProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 1: Dane firmy</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Potwierdz dane firmy i uzupelnij informacje o Google Workspace.
				</p>
				<div className="rounded-md border border-border p-4 space-y-2">
					<div>
						<span className="text-sm text-muted-foreground">Firma: </span>
						<span className="text-foreground font-medium">{clientName}</span>
					</div>
					<div>
						<span className="text-sm text-muted-foreground">Domena: </span>
						<span className="text-foreground font-medium">{domain}</span>
					</div>
					{adminEmail && (
						<div>
							<span className="text-sm text-muted-foreground">Administrator: </span>
							<span className="text-foreground font-medium">
								{adminName ? `${adminName} (${adminEmail})` : adminEmail}
							</span>
						</div>
					)}
				</div>
				<Button onClick={onNext}>Dalej</Button>
			</CardContent>
		</Card>
	);
}

function OAuthConsentStep({
	deploymentId,
	magicLinkToken,
	oauthSuccess,
	onNext,
	onBack,
}: {
	deploymentId: string;
	magicLinkToken: string;
	oauthSuccess: boolean;
	onNext: () => void;
	onBack: () => void;
}) {
	const handleAuthorize = () => {
		const dataServiceUrl = import.meta.env.VITE_DATA_SERVICE_URL;
		window.location.href = `${dataServiceUrl}/api/oauth/google/authorize?type=admin&id=${deploymentId}&token=${magicLinkToken}`;
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 2: Autoryzacja Google Workspace</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
					<p className="font-medium text-foreground">Co zobaczymy:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Liste folderow i nazwy plikow</li>
						<li>Grupy Google w Workspace</li>
					</ul>
					<p className="font-medium text-foreground">Czego NIE zobaczymy:</p>
					<ul className="list-disc list-inside text-sm text-muted-foreground">
						<li>Tresci dokumentow</li>
						<li>Prywatnych wiadomosci</li>
					</ul>
					<p className="text-sm text-muted-foreground">
						Tokeny szyfrowane AES-256-GCM, usuwane na zadanie.
					</p>
				</div>

				<div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3">
					<p className="text-sm text-foreground">
						<strong>Uwaga:</strong> Osoba autoryzujaca musi byc administratorem Google Workspace.
						Jezeli nie jestes administratorem, popros odpowiednia osobe o przeprowadzenie tego
						kroku.
					</p>
				</div>

				{oauthSuccess ? (
					<div className="space-y-2">
						<p className="text-sm text-green-600 dark:text-green-400">
							Autoryzacja zakonczona pomyslnie.
						</p>
						<div className="flex gap-2">
							<Button variant="outline" onClick={onBack}>
								<ArrowLeft className="mr-2 h-4 w-4" />
								Wstecz
							</Button>
							<Button onClick={onNext}>Dalej</Button>
						</div>
					</div>
				) : (
					<div className="flex gap-2">
						<Button variant="outline" onClick={onBack}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Wstecz
						</Button>
						<Button onClick={handleAuthorize}>Autoryzuj Google Workspace</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

interface DelegateChecklistStepProps {
	operatorEmail: string;
	onNext: () => void;
	onBack: () => void;
}

function DelegateChecklistStep({ operatorEmail, onNext, onBack }: DelegateChecklistStepProps) {
	const [confirmed, setConfirmed] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(operatorEmail);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 3: Delegat administracyjny</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Aby kontynuowac, dodaj{" "}
					<span className="font-semibold text-foreground">{operatorEmail}</span> jako administratora
					z uprawnieniami do zarzadzania Dyskiem i Grupami w Google Workspace.
				</p>

				<div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
					<span className="flex-1 font-mono text-sm text-foreground">{operatorEmail}</span>
					<Button variant="ghost" size="icon" onClick={handleCopy} title="Kopiuj email">
						{copied ? (
							<CheckCircle2 className="h-4 w-4 text-primary" />
						) : (
							<Copy className="h-4 w-4 text-muted-foreground" />
						)}
					</Button>
				</div>

				<Button variant="outline" asChild>
					<a href="https://admin.google.com/ac/roles" target="_blank" rel="noopener noreferrer">
						<ExternalLink className="mr-2 h-4 w-4" />
						Otworz Google Admin
					</a>
				</Button>

				<ol className="list-decimal list-inside space-y-2 text-foreground">
					<li>Kliknij przycisk powyzej aby otworzyc Google Admin</li>
					<li>
						Utworz nowa role z uprawnieniami:
						<ul className="ml-6 mt-1 list-disc space-y-1">
							<li>Dysk i Dokumenty (Ustawienia)</li>
							<li>Grupy (Tworzenie, Usuwanie, Odczyt, Aktualizowanie)</li>
						</ul>
					</li>
					<li>Przypisz role do adresu email powyzej</li>
				</ol>

				<label className="flex items-center gap-2 text-foreground">
					<input
						type="checkbox"
						checked={confirmed}
						onChange={(e) => setConfirmed(e.target.checked)}
						className="rounded"
					/>
					Dodalem/am delegata
				</label>
				<div className="flex gap-2">
					<Button variant="outline" onClick={onBack}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Wstecz
					</Button>
					<Button onClick={onNext} disabled={!confirmed}>
						Dalej
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

interface CompletedViewProps {
	deploymentId: string;
	locked: boolean;
	onAddMore: () => void;
}

function CompletedView({ deploymentId, locked, onAddMore }: CompletedViewProps) {
	const employeesQuery = useQuery({
		queryKey: ["employees", deploymentId],
		queryFn: () => getEmployeesByDeployment({ data: { deploymentId } }),
	});

	const employees = employeesQuery.data?.data ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Onboarding zakonczony</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-3 text-foreground">
					<CheckCircle2 className="h-6 w-6 text-primary" />
					<p className="text-lg font-medium">
						{locked ? "Wdrozenie w toku" : "Pracownicy zostali dodani"}
					</p>
				</div>

				{employeesQuery.isPending ? (
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Ladowanie...
					</div>
				) : employees.length > 0 ? (
					<div className="space-y-2">
						<p className="text-sm font-medium text-foreground">
							Dodani pracownicy ({employees.length}):
						</p>
						<div className="rounded-md border border-border divide-y divide-border">
							{employees.map((emp) => (
								<div key={emp.id} className="flex items-center justify-between px-3 py-2">
									<div>
										<p className="text-sm text-foreground">{emp.email}</p>
										{emp.name && <p className="text-xs text-muted-foreground">{emp.name}</p>}
									</div>
									<div className="flex gap-1">
										{emp.departments.map((d) => (
											<span
												key={d.id}
												className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
											>
												{d.name}
											</span>
										))}
									</div>
								</div>
							))}
						</div>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">Brak dodanych pracownikow</p>
				)}

				{locked ? (
					<p className="text-sm text-muted-foreground">
						Operator rozpoczal konfiguracje — nie mozna dodawac nowych pracownikow.
					</p>
				) : (
					<Button variant="outline" onClick={onAddMore}>
						Dodaj wiecej pracownikow
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

interface EmployeeRow {
	email: string;
	name: string;
	departmentIds: string[];
}

interface EmployeeListStepProps {
	deploymentId: string;
	locked: boolean;
	onBack: () => void;
	onSummary: () => void;
}

function EmployeeListStep({ deploymentId, locked, onBack, onSummary }: EmployeeListStepProps) {
	const departmentsQuery = useQuery({
		queryKey: ["departments", deploymentId],
		queryFn: () => getDepartments({ data: { deploymentId } }),
	});

	const existingQuery = useQuery({
		queryKey: ["employees", deploymentId],
		queryFn: () => getEmployeesByDeployment({ data: { deploymentId } }),
	});

	const departments = departmentsQuery.data?.data ?? [];
	const existingEmployees = existingQuery.data?.data ?? [];

	const mutation = useMutation({
		mutationFn: (data: { deploymentId: string; employees: EmployeeRow[] }) =>
			bulkCreateEmployees({ data }),
	});

	const form = useForm({
		defaultValues: {
			employees: [{ email: "", name: "", departmentIds: [] as string[] }] as EmployeeRow[],
		},
		onSubmit: async ({ value }) => {
			mutation.reset();
			await mutation.mutateAsync({
				deploymentId,
				employees: value.employees,
			});
		},
	});

	if (mutation.isSuccess) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Krok 5: Lista pracownikow</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center gap-3 text-foreground">
						<CheckCircle2 className="h-6 w-6 text-primary" />
						<p className="text-lg font-medium">Pracownicy zostali dodani</p>
					</div>
					<p className="text-muted-foreground">
						Lista pracownikow zostala zapisana. Operator wyslij im linki do autoryzacji z panelu
						wdrozenia.
					</p>
					<Button variant="outline" onClick={onSummary}>
						Wroc do podsumowania
					</Button>
				</CardContent>
			</Card>
		);
	}

	if (departmentsQuery.isPending) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Krok 5: Lista pracownikow</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-2 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Ladowanie dzialow...
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 5: Lista pracownikow</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{existingEmployees.length > 0 && (
					<div className="space-y-2">
						<p className="text-sm font-medium text-foreground">
							Dodani pracownicy ({existingEmployees.length}):
						</p>
						<div className="rounded-md border border-border divide-y divide-border">
							{existingEmployees.map((emp) => (
								<div key={emp.id} className="flex items-center justify-between px-3 py-2">
									<div>
										<p className="text-sm text-foreground">{emp.email}</p>
										{emp.name && <p className="text-xs text-muted-foreground">{emp.name}</p>}
									</div>
									<div className="flex gap-1">
										{emp.departments.map((d) => (
											<span
												key={d.id}
												className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
											>
												{d.name}
											</span>
										))}
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{locked ? (
					<p className="text-sm text-muted-foreground">
						Operator rozpoczal konfiguracje — nie mozna dodawac nowych pracownikow.
					</p>
				) : (
					<>
						<p className="text-muted-foreground">
							Dodaj pracownikow, ktorzy powinni autoryzowac dostep do Google Drive. Kazdy otrzyma
							link email z instrukcjami.
						</p>

						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-4"
						>
							{mutation.isError && <Alert variant="destructive">{mutation.error.message}</Alert>}

							<form.Field name="employees" mode="array">
								{(arrayField) => (
									<div className="space-y-3">
										{arrayField.state.value.map((_, i) => (
											<div
												key={`employee-${i.toString()}`}
												className="rounded-md border border-border p-3 space-y-2"
											>
												<div className="flex items-start gap-2">
													<div className="flex-1 space-y-2">
														<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
															<form.Field
																name={`employees[${i}].email`}
																validators={{
																	onChange: ({ value }: { value: string }) => {
																		if (!value) return "Email jest wymagany";
																		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
																			return "Nieprawidlowy format email";
																		return undefined;
																	},
																}}
															>
																{(field) => (
																	<div>
																		<Input
																			placeholder="email@firma.pl"
																			type="email"
																			value={field.state.value}
																			onChange={(e) => field.handleChange(e.target.value)}
																			onBlur={field.handleBlur}
																		/>
																		{field.state.meta.errors.length > 0 && (
																			<p className="mt-1 text-xs text-destructive">
																				{field.state.meta.errors[0]}
																			</p>
																		)}
																	</div>
																)}
															</form.Field>

															<form.Field name={`employees[${i}].name`}>
																{(field) => (
																	<Input
																		placeholder="Jan Kowalski (opcjonalne)"
																		value={field.state.value}
																		onChange={(e) => field.handleChange(e.target.value)}
																		onBlur={field.handleBlur}
																	/>
																)}
															</form.Field>
														</div>

														<form.Field name={`employees[${i}].departmentIds`}>
															{(field) => (
																<DepartmentMultiSelect
																	departments={departments}
																	selectedIds={field.state.value}
																	onChange={(ids) => field.handleChange(ids)}
																/>
															)}
														</form.Field>
													</div>

													{arrayField.state.value.length > 1 && (
														<Button
															type="button"
															variant="ghost"
															size="icon"
															onClick={() => arrayField.removeValue(i)}
															className="mt-0 shrink-0"
															title="Usun pracownika"
														>
															<Trash2 className="h-4 w-4 text-muted-foreground" />
														</Button>
													)}
												</div>
											</div>
										))}

										<Button
											type="button"
											variant="outline"
											onClick={() =>
												arrayField.pushValue({
													email: "",
													name: "",
													departmentIds: [],
												})
											}
											className="w-full"
										>
											<Plus className="mr-2 h-4 w-4" />
											Dodaj pracownika
										</Button>
									</div>
								)}
							</form.Field>

							<div className="flex gap-2">
								<Button type="button" variant="outline" onClick={onBack}>
									<ArrowLeft className="mr-2 h-4 w-4" />
									Wstecz
								</Button>
								<form.Subscribe selector={(s) => s.canSubmit}>
									{(canSubmit) => (
										<Button
											type="submit"
											disabled={!canSubmit || mutation.isPending}
											className="flex-1"
										>
											{mutation.isPending ? (
												<>
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
													Zapisywanie...
												</>
											) : (
												"Wyslij"
											)}
										</Button>
									)}
								</form.Subscribe>
								{existingEmployees.length > 0 && (
									<Button type="button" variant="outline" onClick={onSummary}>
										Dalej
										<ArrowRight className="ml-2 h-4 w-4" />
									</Button>
								)}
							</div>
						</form>
					</>
				)}
			</CardContent>
		</Card>
	);
}

interface DepartmentMultiSelectProps {
	departments: Department[];
	selectedIds: string[];
	onChange: (ids: string[]) => void;
}

function DepartmentMultiSelect({ departments, selectedIds, onChange }: DepartmentMultiSelectProps) {
	const toggleDepartment = (id: string) => {
		if (selectedIds.includes(id)) {
			onChange(selectedIds.filter((sid) => sid !== id));
		} else {
			onChange([...selectedIds, id]);
		}
	};

	if (departments.length === 0) {
		return <p className="text-sm text-muted-foreground">Brak dzialow</p>;
	}

	return (
		<div className="flex flex-wrap gap-2">
			{departments.map((dept) => {
				const selected = selectedIds.includes(dept.id);
				return (
					<button
						key={dept.id}
						type="button"
						onClick={() => toggleDepartment(dept.id)}
						className={cn(
							"rounded-md border px-3 py-1.5 text-sm transition-colors",
							selected
								? "border-primary bg-primary/10 text-primary font-medium"
								: "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
						)}
					>
						{dept.name}
					</button>
				);
			})}
		</div>
	);
}
