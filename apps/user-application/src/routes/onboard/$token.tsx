import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { bulkCreateEmployees } from "@/core/functions/employees/binding";
import { verifyAdminToken } from "@/core/functions/magic-links/binding";

export const Route = createFileRoute("/onboard/$token")({
	loader: ({ params }) => verifyAdminToken({ data: { token: params.token } }),
	component: OnboardingWizard,
});

function OnboardingWizard() {
	const loaderData = Route.useLoaderData();
	const [currentStep, setCurrentStep] = useState(loaderData.step > 0 ? loaderData.step : 1);

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Grota -- Onboarding</h1>

				<div className="flex gap-2">
					{[1, 2, 3, 4].map((step) => (
						<div
							key={step}
							className={`h-2 flex-1 rounded ${step <= currentStep ? "bg-primary" : "bg-muted"}`}
						/>
					))}
				</div>

				{currentStep === 1 && (
					<CompanyInfoStep
						clientName={loaderData.clientName}
						domain={loaderData.domain}
						adminEmail={loaderData.adminEmail}
						adminName={loaderData.adminName}
						onNext={() => setCurrentStep(2)}
					/>
				)}
				{currentStep === 2 && (
					<OAuthPlaceholderStep onNext={() => setCurrentStep(3)} onBack={() => setCurrentStep(1)} />
				)}
				{currentStep === 3 && (
					<DelegateChecklistStep
						operatorEmail={loaderData.operatorEmail}
						onNext={() => setCurrentStep(4)}
						onBack={() => setCurrentStep(2)}
					/>
				)}
				{currentStep === 4 && (
					<EmployeeListStep
						deploymentId={loaderData.deploymentId}
						onBack={() => setCurrentStep(3)}
					/>
				)}
			</div>
		</div>
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

function OAuthPlaceholderStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 2: Autoryzacja Google (wkrotce)</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Ten krok zostanie udostepniony w kolejnej aktualizacji. Na razie przejdz dalej.
				</p>
				<div className="flex gap-2">
					<Button variant="outline" onClick={onBack}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Wstecz
					</Button>
					<Button onClick={onNext}>Dalej</Button>
				</div>
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

const ROLE_OPTIONS = [
	{ value: "zarzad", label: "Zarzad" },
	{ value: "ksiegowosc", label: "Ksiegowosc" },
	{ value: "projekty", label: "Projekty" },
	{ value: "media", label: "Media" },
] as const;

interface EmployeeRow {
	email: string;
	name: string;
	role: "zarzad" | "ksiegowosc" | "projekty" | "media";
}

function EmployeeListStep({ deploymentId, onBack }: { deploymentId: string; onBack: () => void }) {
	const [submitted, setSubmitted] = useState(false);

	const mutation = useMutation({
		mutationFn: (data: { deploymentId: string; employees: EmployeeRow[] }) =>
			bulkCreateEmployees({ data }),
	});

	const form = useForm({
		defaultValues: {
			employees: [{ email: "", name: "", role: "projekty" }] as EmployeeRow[],
		},
		onSubmit: async ({ value }) => {
			mutation.reset();
			await mutation.mutateAsync({
				deploymentId,
				employees: value.employees,
			});
			setSubmitted(true);
		},
	});

	if (submitted) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Krok 4: Lista pracownikow</CardTitle>
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
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 4: Lista pracownikow</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Dodaj pracownikow, ktorzy powinni autoryzowac dostep do Google Drive. Kazdy otrzyma link
					email z instrukcjami.
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
										className="flex items-start gap-2 rounded-md border border-border p-3"
									>
										<div className="flex-1 space-y-2">
											<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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

												<form.Field
													name={`employees[${i}].name`}
													validators={{
														onChange: ({ value }: { value: string }) =>
															!value ? "Imie i nazwisko jest wymagane" : undefined,
													}}
												>
													{(field) => (
														<div>
															<Input
																placeholder="Jan Kowalski"
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

												<form.Field name={`employees[${i}].role`}>
													{(field) => (
														<select
															value={field.state.value}
															onChange={(e) =>
																field.handleChange(e.target.value as EmployeeRow["role"])
															}
															onBlur={field.handleBlur}
															className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
														>
															{ROLE_OPTIONS.map((opt) => (
																<option key={opt.value} value={opt.value}>
																	{opt.label}
																</option>
															))}
														</select>
													)}
												</form.Field>
											</div>
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
								))}

								<Button
									type="button"
									variant="outline"
									onClick={() =>
										arrayField.pushValue({
											email: "",
											name: "",
											role: "projekty",
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
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
