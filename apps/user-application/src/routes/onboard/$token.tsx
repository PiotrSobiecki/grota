import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
				{currentStep === 4 && <EmployeePlaceholderStep />}
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

// Step 4: Placeholder -- replaced with real employee form in doc 003b
function EmployeePlaceholderStep() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Krok 4: Lista pracownikow (wkrotce)</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-muted-foreground">
					Ten krok zostanie udostepniony w kolejnej aktualizacji.
				</p>
			</CardContent>
		</Card>
	);
}
