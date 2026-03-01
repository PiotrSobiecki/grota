import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
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
	const { token } = Route.useParams();
	const loaderData = Route.useLoaderData();
	// Step management: start from backend-persisted step or step 1
	const [currentStep, setCurrentStep] = useState(loaderData.step > 0 ? loaderData.step : 1);

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Grota -- Onboarding</h1>

				{/* Step indicator */}
				<div className="flex gap-2">
					{[1, 2, 3, 4].map((step) => (
						<div
							key={step}
							className={`h-2 flex-1 rounded ${step <= currentStep ? "bg-primary" : "bg-muted"}`}
						/>
					))}
				</div>

				{currentStep === 1 && <CompanyInfoStep token={token} onNext={() => setCurrentStep(2)} />}
				{currentStep === 2 && <OAuthPlaceholderStep onNext={() => setCurrentStep(3)} />}
				{currentStep === 3 && <DelegateChecklistStep onNext={() => setCurrentStep(4)} />}
				{currentStep === 4 && <EmployeeListStep deploymentId={loaderData.deploymentId} />}
			</div>
		</div>
	);
}

// Step 1: Company info (domain auto-filled from deployment)
function CompanyInfoStep({ token: _token, onNext }: { token: string; onNext: () => void }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 1: Dane firmy</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Potwierdz dane firmy i uzupelnij informacje o Google Workspace.
				</p>
				{/* Form fields: workspace admin email, additional notes */}
				<Button onClick={onNext}>Dalej</Button>
			</CardContent>
		</Card>
	);
}

// Step 2: OAuth placeholder (implemented in doc 004)
function OAuthPlaceholderStep({ onNext }: { onNext: () => void }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 2: Autoryzacja Google (wkrotce)</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Ten krok zostanie udostepniony w kolejnej aktualizacji. Na razie przejdz dalej.
				</p>
				<Button onClick={onNext}>Dalej</Button>
			</CardContent>
		</Card>
	);
}

// Step 3: Admin delegate checklist
function DelegateChecklistStep({ onNext }: { onNext: () => void }) {
	const [confirmed, setConfirmed] = useState(false);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 3: Delegat administracyjny</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Aby przeprowadzic migracje, potrzebujemy dostepu jako delegat administracyjny w Twoim
					Google Workspace.
				</p>
				<ol className="list-decimal list-inside space-y-2 text-foreground">
					<li>Zaloguj sie do Google Admin Console (admin.google.com)</li>
					<li>Przejdz do Konto &rarr; Role administratora</li>
					<li>Dodaj operatora jako delegata z dostepem do katalogu</li>
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
				<Button onClick={onNext} disabled={!confirmed}>
					Dalej
				</Button>
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

// Step 4: Employee list form
function EmployeeListStep({ deploymentId }: { deploymentId: string }) {
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
						{(field) => (
							<div className="space-y-3">
								{field.state.value.map((_, i) => (
									<EmployeeFormRow
										key={`employee-${i.toString()}`}
										form={form}
										index={i}
										canRemove={field.state.value.length > 1}
										onRemove={() => field.removeValue(i)}
									/>
								))}

								<Button
									type="button"
									variant="outline"
									onClick={() =>
										field.pushValue({
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

					<form.Subscribe selector={(s) => s.canSubmit}>
						{(canSubmit) => (
							<Button type="submit" disabled={!canSubmit || mutation.isPending} className="w-full">
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
				</form>
			</CardContent>
		</Card>
	);
}

interface EmployeeFormRowProps {
	form: ReturnType<typeof useForm<{ employees: EmployeeRow[] }>>;
	index: number;
	canRemove: boolean;
	onRemove: () => void;
}

function EmployeeFormRow({ form, index, canRemove, onRemove }: EmployeeFormRowProps) {
	return (
		<div className="flex items-start gap-2 rounded-md border border-border p-3">
			<div className="flex-1 space-y-2">
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
					<form.Field
						name={`employees[${index}].email`}
						validators={{
							onChange: ({ value }) => {
								if (!value) return "Email jest wymagany";
								if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Nieprawidlowy format email";
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
									<p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field
						name={`employees[${index}].name`}
						validators={{
							onChange: ({ value }) => (!value ? "Imie i nazwisko jest wymagane" : undefined),
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
									<p className="mt-1 text-xs text-destructive">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					</form.Field>

					<form.Field name={`employees[${index}].role`}>
						{(field) => (
							<select
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value as EmployeeRow["role"])}
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

			{canRemove && (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					onClick={onRemove}
					className="mt-0 shrink-0"
					title="Usun pracownika"
				>
					<Trash2 className="h-4 w-4 text-muted-foreground" />
				</Button>
			)}
		</div>
	);
}
